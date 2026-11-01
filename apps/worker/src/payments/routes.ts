/**
 * Money REST surface for the web app: wallet, mandate revocation, and the PayPal JS SDK
 * v6 handshakes (client token, save-wallet setup, one-time share orders).
 *
 * Cookie session, JSON, same-origin. Every id in a request is resolved inside the
 * caller's own UserDO or checked against thread + pact membership, so someone else's
 * mandate, setup token or order is simply "not found". Amounts are computed server-side;
 * the only client-chosen number is the member's cap, which is validated twice.
 */

import {
  completeMandateSetup,
  idempotencyKey,
  type PayPalClient,
  PayPalError,
  startMandateSetup,
} from "@pact/paypal";
import { authorize } from "@pact/policy";
import { Money, type SpendIntent } from "@pact/protocol";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { sessionUser } from "../auth/session";
import type { PactView } from "../do/thread";
import { allowedOrigins, type Env } from "../env";
import { newId, nowIso } from "../ids";
import { originAllowed } from "../security";
import { capProblem, mandateFor, pactOpen, shareOf } from "./pacts";
import { failureReason, PayPalNotConfigured, paypalFor } from "./paypal";
import { indexPayPalRef } from "./refs";

type Vars = { userId: string };
type C = Context<{ Bindings: Env; Variables: Vars }>;

const ThreadId = z.string().regex(/^thr_[A-Za-z0-9]{4,40}$/);
const PactId = z.string().regex(/^pact_[A-Za-z0-9]{4,40}$/);
const PayPalId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const PactRef = z.object({ threadId: ThreadId, pactId: PactId });
const SetupBody = PactRef.extend({ cap: Money.refine((m) => m.amountMinor > 0) });
const PaymentTokenBody = PactRef.extend({ vaultSetupToken: PayPalId });

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

const requireUser: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const userId = await sessionUser(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  // SameSite=Strict already stops cross-site cookies; the Origin check is defense in depth.
  if (c.req.method !== "GET" && !originAllowed(c.req.raw, allowedOrigins(c.env))) {
    return c.json({ error: "forbidden" }, 403);
  }
  c.set("userId", userId);
  await next();
};

/** Payment handshakes are cheap to call and costly to abuse: share the per-user limit. */
const userRateLimit: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const { success } = await c.env.USER_LIMITER.limit({ key: `pay:${c.get("userId")}` });
  if (!success) return c.json({ error: "rate_limited" }, 429);
  await next();
};

export const payments = new Hono<{ Bindings: Env; Variables: Vars }>();

payments.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, ...err.extra }, err.status);
  if (err instanceof z.ZodError) return c.json({ error: "invalid_body" }, 400);
  if (err instanceof PayPalNotConfigured) return c.json({ error: "paypal_unavailable" }, 503);
  if (err instanceof PayPalError) {
    console.warn("paypal call failed", err.route, err.status, err.debugId);
    const status = err.status >= 400 && err.status < 500 ? 422 : 502;
    return c.json({ error: failureReason(err) }, status);
  }
  console.error("payments route failed", (err as Error)?.name);
  return c.json({ error: "internal" }, 500);
});

payments.use("/wallet", requireUser);
payments.use("/mandates/*", requireUser);
payments.use("/paypal/*", requireUser, userRateLimit);

// ── Wallet & mandates ──

payments.get("/wallet", async (c) => c.json(await user(c).wallet()));

payments.post("/mandates/:id/revoke", async (c) => {
  const found = await user(c).revokeMandate(c.req.param("id").slice(0, 128));
  if (!found) throw new HttpError(404, "not_found");
  return c.json({ ok: true });
});

// ── PayPal JS SDK v6 handshakes ──

payments.get("/paypal/client-token", async (c) => {
  const pp = livePayPal(c);
  const customerId = await user(c).customerId();
  const token = await pp.clientToken(customerId ? { targetCustomerId: customerId } : {});
  return c.json({ clientToken: token.token });
});

payments.post("/paypal/setup-token", async (c) => {
  const body = SetupBody.parse(await c.req.json());
  const pp = livePayPal(c);
  const view = await pactFor(c, body);
  const problem = capProblem(view, c.get("userId"), body.cap);
  if (problem) throw new HttpError(422, problem);
  const origin = appOrigin(c);
  const customerId = await user(c).customerId();
  const started = await startMandateSetup(pp, {
    returnUrl: `${origin}/app?paypal=approved`,
    cancelUrl: `${origin}/app?paypal=cancelled`,
    description: `Pact: ${view.pact.title}`.slice(0, 127),
    brandName: "Pact",
    usagePattern: "UNSCHEDULED_POSTPAID",
    ...(customerId ? { customerId } : {}),
    // One key per request: internal retries replay it, a deliberate second commit
    // attempt gets a fresh token (setup tokens reserve nothing).
    requestId: `setup:${newId("req")}`,
  });
  await user(c).beginSetup({
    setupTokenId: started.setupTokenId,
    threadId: body.threadId,
    pactId: body.pactId,
    cap: body.cap,
  });
  return c.json({ vaultSetupToken: started.setupTokenId });
});

payments.post("/paypal/payment-token", async (c) => {
  const body = PaymentTokenBody.parse(await c.req.json());
  const userId = c.get("userId");
  const pp = livePayPal(c);
  const setup = await user(c).setup(body.vaultSetupToken);
  if (!setup || setup.threadId !== body.threadId || setup.pactId !== body.pactId) {
    throw new HttpError(404, "not_found");
  }
  if (setup.mandateId) return c.json({ mandateId: setup.mandateId });

  const view = await pactFor(c, body);
  const problem = capProblem(view, userId, setup.cap);
  if (problem) throw new HttpError(422, problem);

  const funding = await completeMandateSetup(pp, {
    setupTokenId: setup.setupTokenId,
    requestId: `vault:${setup.setupTokenId}`,
  });
  const mandate = await user(c).completeSetup({
    setupTokenId: setup.setupTokenId,
    userId,
    vaultId: funding.vaultId,
    customerId: funding.customerId,
    payerEmail: funding.payerEmail,
    mandate: mandateFor({
      id: newId("mnd"),
      userId,
      pact: view.pact,
      cap: setup.cap,
      now: new Date(),
    }),
    label: view.pact.title,
  });
  const committed = await thread(c, body.threadId).commitPactMember(body.pactId, userId, {
    cap: setup.cap,
    mandateId: mandate.id,
  });
  if (!committed) {
    await user(c).revokeMandate(mandate.id);
    throw new HttpError(409, "split_unfundable");
  }
  return c.json({ mandateId: mandate.id });
});

payments.post("/paypal/orders", async (c) => {
  const body = PactRef.parse(await c.req.json());
  const userId = c.get("userId");
  const pp = livePayPal(c);
  const view = await pactFor(c, body);
  if (!pactOpen(view)) throw new HttpError(409, "pact_closed");
  const share = shareOf(view, userId);
  if (!share || share.amountMinor === 0) throw new HttpError(422, "no_share");
  if (await user(c).paidPact(body.pactId)) throw new HttpError(409, "already_paid");
  await checkPolicy(c, orderIntent(view, userId, share));

  const order = await pp.orders.create(
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: share,
          custom_id: body.pactId,
          description: `Your share of "${view.pact.title}"`.slice(0, 127),
        },
      ],
    },
    { requestId: await idempotencyKey("order", body.pactId, userId, String(share.amountMinor)) },
  );
  await user(c).recordOrder({
    orderId: order.id,
    threadId: body.threadId,
    pactId: body.pactId,
    amount: share,
  });
  await indexPayPalRef(c.env, order.id, {
    userId,
    threadId: body.threadId,
    pactId: body.pactId,
    paymentId: `order:${order.id}`,
  });
  return c.json({ orderId: order.id });
});

payments.post("/paypal/orders/:id/capture", async (c) => {
  const orderId = PayPalId.parse(c.req.param("id"));
  const userId = c.get("userId");
  const pp = livePayPal(c);
  const order = await user(c).order(orderId);
  if (!order) throw new HttpError(404, "not_found");
  if (order.status === "captured") return c.json({ status: "COMPLETED" });

  const view = await pactFor(c, order);
  const share = shareOf(view, userId);
  // The split may have moved since the order was created; never capture a stale amount.
  if (!share || share.amountMinor !== order.amount.amountMinor) {
    throw new HttpError(409, "share_changed");
  }
  await checkPolicy(c, orderIntent(view, userId, share));

  let status: "COMPLETED" | "PENDING" | "DECLINED";
  let captureId: string | undefined;
  let reason: string | undefined;
  try {
    const res = await pp.orders.capture(orderId, { requestId: `capture:${orderId}` });
    const cap = res.purchase_units?.[0]?.payments?.captures?.[0];
    captureId = cap?.id;
    status =
      cap?.status === "COMPLETED"
        ? "COMPLETED"
        : cap?.status === "PENDING"
          ? "PENDING"
          : "DECLINED";
    if (status === "DECLINED") reason = cap?.status ?? "no_capture";
  } catch (e) {
    // The buyer can pick another funding source and retry; anything else is an error.
    if (!(e instanceof PayPalError && e.issues.includes("INSTRUMENT_DECLINED"))) throw e;
    status = "DECLINED";
    reason = "INSTRUMENT_DECLINED";
  }

  await user(c).orderCaptured({
    orderId,
    userId,
    status: status === "COMPLETED" ? "captured" : status === "PENDING" ? "pending" : "declined",
    ...(captureId ? { captureId } : {}),
    ...(reason ? { reason } : {}),
  });
  if (status !== "PENDING") {
    await thread(c, order.threadId).recordPayments(
      [
        {
          kind: status === "COMPLETED" ? "charged" : "chargeFailed",
          userId,
          pactId: order.pactId,
          amount: order.amount,
          paypalRef: captureId ?? orderId,
        },
      ],
      status === "COMPLETED" ? { pactId: order.pactId, userId, status: "charged" } : undefined,
    );
  }
  return c.json({ status, ...(reason ? { reason } : {}) });
});

// ── Helpers ──

function user(c: C) {
  return c.env.USER.get(c.env.USER.idFromName(c.get("userId")));
}

function thread(c: C, threadId: string) {
  return c.env.THREAD.get(c.env.THREAD.idFromName(threadId));
}

/** Simulated mode has no PayPal to hand the browser, so the SDK handshakes are off. */
function livePayPal(c: C): PayPalClient {
  const pp = paypalFor(c.env);
  if (!pp) throw new HttpError(503, "paypal_disabled");
  return pp;
}

async function pactFor(c: C, ref: { threadId: string; pactId: string }): Promise<PactView> {
  const view = await thread(c, ref.threadId).pactForMember(ref.pactId, c.get("userId"));
  if (!view) throw new HttpError(404, "not_found");
  return view as PactView;
}

function orderIntent(view: PactView, userId: string, share: Money): SpendIntent {
  return {
    id: `ord_${view.pact.id}_${userId}`.slice(0, 128),
    userId,
    pactId: view.pact.id,
    amount: share,
    merchant: view.merchant,
    ...(view.category ? { category: view.category } : {}),
    description: `Your share of "${view.pact.title}"`.slice(0, 500),
    initiatedBy: "user",
    at: nowIso(),
  };
}

/**
 * The buyer approving in PayPal's own UI is the approval, so `needs_approval` passes
 * here; hard denials (currency, merchant rules) still stop the order. Mandates scoped
 * to other pacts don't apply to this one, so they can't turn "no mandate" into a deny.
 */
async function checkPolicy(c: C, intent: SpendIntent): Promise<void> {
  const { mandates, ledger } = await user(c).policyState();
  const applicable = mandates.filter((m) => !m.pactId || m.pactId === intent.pactId);
  const decision = authorize(intent, applicable, ledger);
  if (decision.outcome === "deny") {
    throw new HttpError(403, "policy_denied", { reasons: decision.reasons });
  }
}

/** The page the buyer returns to after a redirect fallback: the caller's own origin. */
function appOrigin(c: C): string {
  const allowed = allowedOrigins(c.env);
  const origin = c.req.header("Origin");
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0] ?? new URL(c.req.url).origin;
}
