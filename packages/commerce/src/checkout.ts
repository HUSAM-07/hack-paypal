/**
 * Checkout: quote → re-verify → AUTHORIZE (vaulted wallet, payee = seller) → cooling-off →
 * capture, or void on cancel.
 *
 * Two layers:
 *  - `transition(checkout, event, now)` is pure and owns every rule: never capture while the
 *    cooling-off window is open (unless the user said "capture now"), never capture once a
 *    cancel was asked for, never authorize something that wasn't re-verified.
 *  - `checkoutWorkflowSteps` are the effects (PayPal, live quote). Each returns an event; the
 *    caller applies it with `transition`. A Cloudflare `AgentWorkflow` wraps each step in
 *    `step.do(...)` and sleeps with `step.sleepUntil(waitCoolingOff(...).until)`.
 *
 * Every PayPal call carries `PayPal-Request-Id = shop:<orderId>:<step>`, so a retried step
 * replays instead of double-charging.
 */
import { captureAll, chargeMandate, idempotencyKey, PayPalError, voidAll } from "@pact/paypal";
import type { LedgerEntry } from "@pact/policy";
import type { Mandate } from "@pact/protocol";
import type { Offer, Order } from "./contract";
import type { CommerceDeps } from "./deps";
import { checkPurchase, type RuleTerms } from "./mandate";
import type { Quote } from "./sellers";

export type CheckoutPhase =
  /** Priced; not yet re-verified or not yet authorized. */
  | "quoted"
  /** Something changed since the user agreed; nothing is held. */
  | "needsReview"
  /** PayPal holds the money; capture waits for the cooling-off window. */
  | "authorized"
  | "captured"
  | "voided"
  | "failed";

export interface Checkout {
  orderId: string;
  userId: string;
  offer: Offer;
  quantity: number;
  /** The price the user (or their rule) agreed to; replaced by the re-verified quote. */
  quote: Quote;
  mandateId: string;
  watchId?: string;
  initiatedBy: "user" | "schedule";
  phase: CheckoutPhase;
  verifiedAt?: string;
  coolingOffMinutes: number;
  coolingOffEndsAt?: string;
  cancelRequested: boolean;
  captureNowRequested: boolean;
  paypal: { orderId?: string; authorizationId?: string; captureId?: string };
  failureReason?: string;
  reviewReason?: string;
  createdAt: string;
  updatedAt: string;
  log: { at: string; event: CheckoutEvent["type"] }[];
}

export type CheckoutEvent =
  | { type: "reverified"; quote: Quote }
  | { type: "reviewNeeded"; reason: string }
  | { type: "authorized"; paypalOrderId: string; authorizationId: string }
  | { type: "cancelRequested" }
  | { type: "captureNowRequested" }
  | { type: "captured"; captureId: string }
  | { type: "voided" }
  | { type: "failed"; reason: string };

export class InvalidTransition extends Error {
  override readonly name = "InvalidTransition";
  constructor(
    readonly phase: CheckoutPhase,
    readonly event: CheckoutEvent["type"],
    why: string,
  ) {
    super(`checkout ${phase} cannot take ${event}: ${why}`);
  }
}

export function newCheckout(input: {
  orderId: string;
  userId: string;
  offer: Offer;
  quantity: number;
  quote: Quote;
  mandateId: string;
  watchId?: string | undefined;
  initiatedBy: "user" | "schedule";
  coolingOffMinutes: number;
  now: Date;
}): Checkout {
  const at = input.now.toISOString();
  return {
    orderId: input.orderId,
    userId: input.userId,
    offer: input.offer,
    quantity: input.quantity,
    quote: input.quote,
    mandateId: input.mandateId,
    ...(input.watchId ? { watchId: input.watchId } : {}),
    initiatedBy: input.initiatedBy,
    phase: "quoted",
    coolingOffMinutes: input.coolingOffMinutes,
    cancelRequested: false,
    captureNowRequested: false,
    paypal: {},
    createdAt: at,
    updatedAt: at,
    log: [],
  };
}

const TERMINAL: ReadonlySet<CheckoutPhase> = new Set(["captured", "voided", "failed"]);

export function isTerminal(c: Pick<Checkout, "phase">): boolean {
  return TERMINAL.has(c.phase);
}

export function coolingOffOpen(c: Checkout, now: Date): boolean {
  return (
    c.phase === "authorized" &&
    c.coolingOffEndsAt !== undefined &&
    now.getTime() < Date.parse(c.coolingOffEndsAt)
  );
}

/** Pure. Throws `InvalidTransition` for anything the rules forbid. */
export function transition(c: Checkout, e: CheckoutEvent, now: Date): Checkout {
  const fail = (why: string): never => {
    throw new InvalidTransition(c.phase, e.type, why);
  };
  const at = now.toISOString();
  const next: Checkout = {
    ...c,
    paypal: { ...c.paypal },
    updatedAt: at,
    log: [...c.log, { at, event: e.type }],
  };

  switch (e.type) {
    case "reverified":
      if (c.phase !== "quoted") fail("only a quoted checkout is re-verified");
      next.quote = e.quote;
      next.verifiedAt = at;
      return next;
    case "reviewNeeded":
      if (c.phase !== "quoted") fail("only a quoted checkout can pause for review");
      next.phase = "needsReview";
      next.reviewReason = e.reason.slice(0, 300);
      return next;
    case "authorized":
      if (c.phase !== "quoted") fail("authorize once, from quoted");
      if (!c.verifiedAt) fail("re-verify before money moves");
      if (c.cancelRequested) fail("cancelled before authorization");
      next.phase = "authorized";
      next.paypal.orderId = e.paypalOrderId;
      next.paypal.authorizationId = e.authorizationId;
      next.coolingOffEndsAt = new Date(now.getTime() + c.coolingOffMinutes * 60_000).toISOString();
      return next;
    case "cancelRequested":
      if (c.phase === "captured") fail("already captured; that's a refund, not an undo");
      if (isTerminal(c)) return c;
      next.cancelRequested = true;
      // Nothing is held before authorization: cancelling is immediate.
      if (c.phase === "quoted" || c.phase === "needsReview") next.phase = "voided";
      return next;
    case "captureNowRequested":
      if (c.phase !== "authorized") fail("nothing to capture");
      if (c.cancelRequested) fail("cancel already requested");
      next.captureNowRequested = true;
      return next;
    case "captured":
      if (c.phase !== "authorized") fail("capture needs an authorization");
      if (c.cancelRequested) fail("void before pay: a cancel is pending");
      if (coolingOffOpen(c, now) && !c.captureNowRequested) fail("cooling-off window still open");
      next.phase = "captured";
      next.paypal.captureId = e.captureId;
      return next;
    case "voided":
      if (c.phase !== "authorized") fail("only an authorization can be voided");
      next.phase = "voided";
      next.cancelRequested = true;
      return next;
    case "failed":
      if (isTerminal(c)) fail("already finished");
      next.phase = "failed";
      next.failureReason = e.reason.slice(0, 300);
      return next;
  }
}

export type CheckoutStep = "reverify" | "authorize" | "wait" | "capture" | "void" | "done";

/** What has to happen next, given the state and the time. */
export function nextStep(c: Checkout, now: Date): CheckoutStep {
  if (c.phase === "quoted") return c.verifiedAt ? "authorize" : "reverify";
  if (c.phase === "authorized") {
    if (c.cancelRequested) return "void";
    if (c.captureNowRequested || !coolingOffOpen(c, now)) return "capture";
    return "wait";
  }
  return "done";
}

/** `PayPal-Request-Id` for one checkout step: `shop:<orderId>:<step>` (hashed past 108 chars). */
export function checkoutRequestId(
  orderId: string,
  step: "authorize" | "capture" | "void",
): Promise<string> {
  return idempotencyKey("shop", orderId, step);
}

export function describeError(e: unknown): string {
  if (e instanceof PayPalError) {
    const issue = e.issues[0];
    return `PayPal ${e.code}${issue ? ` (${issue})` : ""}`;
  }
  return e instanceof Error ? e.message.slice(0, 200) : "unknown error";
}

export interface ReverifyContext {
  mandate: Mandate | undefined;
  rule?: RuleTerms | undefined;
  ledger: readonly LedgerEntry[];
}

export interface CheckoutOptions {
  /**
   * What goes in `purchase_units[].custom_id` (≤127 chars). Today our order id; the CITED seam
   * puts the signed Agent Affiliate Passport here.
   */
  customIdFor?: (c: Checkout) => string;
}

/**
 * The effects, one per Workflow step. Each reads only the checkout it's given and returns the
 * event to apply. Re-load the checkout from storage before `capture`, so a cancel that landed
 * during the sleep wins (the `transition` guard enforces it either way).
 */
export const checkoutWorkflowSteps = {
  /** Live re-quote from the seller, then the mandate check, before any money moves. */
  async reverify(deps: CommerceDeps, c: Checkout, ctx: ReverifyContext): Promise<CheckoutEvent> {
    const now = deps.clock.now();
    const live = await deps.sellers.quote(c.offer.id, c.quantity, now);
    if (!live) return { type: "failed", reason: "The seller no longer lists this product." };
    if (c.quote.variant && live.variant && c.quote.variant !== live.variant) {
      return {
        type: "reviewNeeded",
        reason: `The listing changed from “${c.quote.variant}” to “${live.variant}”.`,
      };
    }
    const verdict = checkPurchase({
      intentId: `${c.orderId}:intent`,
      userId: c.userId,
      offer: c.offer,
      quote: live,
      mandate: ctx.mandate,
      rule: ctx.rule,
      ledger: ctx.ledger,
      now,
      initiatedBy: c.initiatedBy,
    });
    if (!verdict.ok) {
      return {
        type: "failed",
        reason: `Not within what you approved: ${verdict.reasons.join(", ")}.`,
      };
    }
    return { type: "reverified", quote: live };
  },

  /** Orders v2 `intent: AUTHORIZE` against the vaulted wallet, payee = the seller. */
  async authorize(
    deps: CommerceDeps,
    c: Checkout,
    wallet: { vaultId: string },
    opts: CheckoutOptions = {},
  ): Promise<CheckoutEvent> {
    const seller = c.offer.merchant.paypalSellerId;
    if (!c.offer.buyable || !seller) return { type: "failed", reason: "Not a PayPal seller." };
    try {
      const res = await chargeMandate(deps.paypal, {
        vaultId: wallet.vaultId,
        amount: c.quote.total,
        customId: (opts.customIdFor?.(c) ?? c.orderId).slice(0, 127),
        description: `${c.quantity} × ${c.offer.title}`.slice(0, 127),
        payee: { merchant_id: seller },
        intent: "AUTHORIZE",
        requestId: await checkoutRequestId(c.orderId, "authorize"),
      });
      if (res.outcome !== "succeeded" || !res.authorization) {
        return { type: "failed", reason: `PayPal authorization ${res.outcome}.` };
      }
      return {
        type: "authorized",
        paypalOrderId: res.orderId,
        authorizationId: res.authorization.id,
      };
    } catch (e) {
      return { type: "failed", reason: describeError(e) };
    }
  },

  /** Where the Workflow sleeps: until the window closes, or not at all. */
  waitCoolingOff(c: Checkout, now: Date): { ready: true } | { ready: false; until: string } {
    if (c.phase !== "authorized" || c.cancelRequested || c.captureNowRequested)
      return { ready: true };
    return coolingOffOpen(c, now) && c.coolingOffEndsAt
      ? { ready: false, until: c.coolingOffEndsAt }
      : { ready: true };
  },

  /** Capture the hold. A failed capture voids the hold so nothing stays reserved. */
  async capture(deps: CommerceDeps, c: Checkout): Promise<CheckoutEvent> {
    const authorizationId = c.paypal.authorizationId;
    if (!authorizationId) return { type: "failed", reason: "No authorization to capture." };
    const res = await captureAll(deps.paypal, {
      holds: [{ memberId: c.orderId, authorizationId }],
      requestIdPrefix: "shop",
    });
    const captured = res.captured[0];
    if (res.ok && captured) return { type: "captured", captureId: captured.captureId };
    await voidAll(deps.paypal, {
      holds: [{ memberId: c.orderId, authorizationId }],
      requestIdPrefix: "shop",
    }).catch(() => undefined);
    return { type: "failed", reason: `Capture failed: ${res.failed[0]?.reason ?? "unknown"}.` };
  },

  /** Undo: release the hold. Already-voided or expired counts as released. */
  async void(deps: CommerceDeps, c: Checkout): Promise<CheckoutEvent | undefined> {
    const authorizationId = c.paypal.authorizationId;
    if (!authorizationId) return { type: "voided" };
    const res = await voidAll(deps.paypal, {
      holds: [{ memberId: c.orderId, authorizationId }],
      requestIdPrefix: "shop",
    });
    // Couldn't void: stay authorized with the cancel pending (capture stays blocked); retry.
    return res.ok ? { type: "voided" } : undefined;
  },

  /** The receipt the UI renders. */
  receipt(c: Checkout): Order | undefined {
    return toOrder(c);
  },
};

/** The public `Order` for a checkout that reached PayPal (or failed/cancelled trying). */
export function toOrder(c: Checkout): Order | undefined {
  const status: Order["status"] | undefined =
    c.phase === "authorized"
      ? "coolingOff"
      : c.phase === "captured"
        ? "captured"
        : c.phase === "voided"
          ? "voided"
          : c.phase === "failed"
            ? "failed"
            : undefined;
  if (!status) return undefined;
  const order: Order = {
    id: c.orderId,
    offer: c.offer,
    quantity: c.quantity,
    total: c.quote.total,
    status,
    paypal: {
      orderId: c.paypal.orderId ?? "",
      ...(c.paypal.authorizationId ? { authorizationId: c.paypal.authorizationId } : {}),
      ...(c.paypal.captureId ? { captureId: c.paypal.captureId } : {}),
    },
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
  if (c.coolingOffEndsAt) order.coolingOffEndsAt = c.coolingOffEndsAt;
  if (c.watchId) order.watchId = c.watchId;
  if (c.failureReason) order.failureReason = c.failureReason;
  return order;
}

export interface AdvanceContext extends ReverifyContext {
  wallet: { vaultId: string } | undefined;
  options?: CheckoutOptions;
}

/**
 * Runs steps until the checkout has to wait (cooling-off) or is finished. The in-Durable-Object
 * path; a Workflow calls the same steps one by one.
 */
export async function advanceCheckout(
  deps: CommerceDeps,
  start: Checkout,
  ctx: AdvanceContext,
): Promise<{ checkout: Checkout; waitUntil?: string }> {
  let c = start;
  for (let guard = 0; guard < 8; guard++) {
    const now = deps.clock.now();
    const step = nextStep(c, now);
    let event: CheckoutEvent | undefined;
    switch (step) {
      case "done":
        return { checkout: c };
      case "wait":
        return { checkout: c, waitUntil: c.coolingOffEndsAt as string };
      case "reverify":
        event = await checkoutWorkflowSteps.reverify(deps, c, ctx);
        break;
      case "authorize":
        event = ctx.wallet
          ? await checkoutWorkflowSteps.authorize(deps, c, ctx.wallet, ctx.options)
          : { type: "failed", reason: "Connect your PayPal wallet first." };
        break;
      case "capture":
        event = await checkoutWorkflowSteps.capture(deps, c);
        break;
      case "void":
        event = await checkoutWorkflowSteps.void(deps, c);
        if (!event) return { checkout: c };
        break;
    }
    c = transition(c, event, deps.clock.now());
  }
  return { checkout: c };
}
