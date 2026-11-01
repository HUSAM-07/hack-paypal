/**
 * POST /api/paypal/webhooks. No session: the PayPal signature is the authentication.
 * Order of operations matters: verify the raw bytes, then parse, then claim the event id
 * (D1 INSERT OR IGNORE is atomic), then route. A routing failure releases the claim and
 * returns 500 so PayPal redelivers.
 */
import { type ParsedWebhook, parseWebhookEvent } from "@pact/paypal";
import { Hono } from "hono";
import type { Env } from "../env";
import { nowIso } from "../ids";
import { certCache, paypalFor } from "./paypal";
import { ownerOfRef, sha256Hex } from "./refs";

const MAX_BODY = 256 * 1024;
const PAYOUT_FAILED = new Set(["BLOCKED", "CANCELED", "DENIED", "FAILED", "REFUNDED", "RETURNED"]);

export const webhooks = new Hono<{ Bindings: Env }>();

webhooks.post("/", async (c) => {
  const pp = paypalFor(c.env);
  if (!pp) return c.json({ error: "paypal_disabled" }, 404);
  const webhookId = c.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return c.json({ error: "paypal_unavailable" }, 503);

  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.json({ error: "too_large" }, 413);
  const verified = await pp.webhooks.verifySelf({
    webhookId,
    headers: c.req.raw.headers,
    rawBody: raw,
    certCache,
  });
  if (!verified.ok) return c.json({ error: verified.reason }, 400);

  let parsed: ParsedWebhook;
  try {
    parsed = parseWebhookEvent(raw);
  } catch {
    return c.json({ error: "invalid_event" }, 400);
  }
  const id = parsed.known ? parsed.event.id : parsed.id;
  const type = parsed.known ? parsed.event.event_type : parsed.eventType;
  const claim = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO paypal_webhook_events (id, event_type, received_at) VALUES (?, ?, ?)",
  )
    .bind(id, type, nowIso())
    .run();
  if (claim.meta.changes === 0) return c.json({ ok: true, duplicate: true });

  try {
    if (parsed.known) await route(c.env, parsed.event, raw);
  } catch (err) {
    console.error("webhook routing failed", type, (err as Error)?.name);
    await c.env.DB.prepare("DELETE FROM paypal_webhook_events WHERE id = ?").bind(id).run();
    return c.json({ error: "retry" }, 500);
  }
  return c.json({ ok: true });
});

type Event = Extract<ParsedWebhook, { known: true }>["event"];

async function route(env: Env, event: Event, raw: string): Promise<void> {
  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED":
    case "PAYMENT.CAPTURE.DECLINED":
    case "PAYMENT.CAPTURE.DENIED": {
      const capture = event.resource as { id: string };
      const status = event.event_type === "PAYMENT.CAPTURE.COMPLETED" ? "charged" : "failed";
      // Our row may know the capture id, or only the order id if the capture was pending.
      const refs = [capture.id, relatedOrderId(raw)].filter((r): r is string => !!r);
      await applyUpdate(env, refs, status, status === "charged" ? "charged" : "chargeFailed");
      return;
    }
    case "PAYMENT.CAPTURE.REFUNDED": {
      const captureId = upLinkId(event.resource as { links?: { rel: string; href: string }[] });
      if (captureId) await applyUpdate(env, [captureId], "refunded", "refunded");
      return;
    }
    case "PAYMENT.PAYOUTS-ITEM.SUCCEEDED":
    case "PAYMENT.PAYOUTS-ITEM.BLOCKED":
    case "PAYMENT.PAYOUTS-ITEM.CANCELED":
    case "PAYMENT.PAYOUTS-ITEM.DENIED":
    case "PAYMENT.PAYOUTS-ITEM.FAILED":
    case "PAYMENT.PAYOUTS-ITEM.REFUNDED":
    case "PAYMENT.PAYOUTS-ITEM.RETURNED": {
      const item = event.resource as { payout_batch_id?: string; transaction_status?: string };
      const failed = PAYOUT_FAILED.has(event.event_type.split(".").at(-1) ?? "");
      if (item.payout_batch_id && failed) {
        await applyUpdate(env, [item.payout_batch_id], "failed", "payoutFailed");
      }
      return;
    }
    case "VAULT.PAYMENT-TOKEN.DELETED": {
      const hash = await sha256Hex((event.resource as { id: string }).id);
      const owner = await ownerOfRef(env, `vault:${hash}`);
      if (owner) await env.USER.get(env.USER.idFromName(owner.userId)).fundingDeleted(hash);
      return;
    }
    default:
      // Created/approved/voided/processing events confirm what our synchronous calls
      // already recorded; nothing to do.
      return;
  }
}

async function applyUpdate(
  env: Env,
  refs: string[],
  status: "charged" | "failed" | "refunded",
  kind: "charged" | "chargeFailed" | "refunded" | "payoutFailed",
): Promise<void> {
  for (const ref of refs) {
    const owner = await ownerOfRef(env, ref);
    if (!owner) continue;
    const user = env.USER.get(env.USER.idFromName(owner.userId));
    const change = await user.applyPaymentUpdate({ paypalRef: ref, status, userId: owner.userId });
    if (!change) return;
    if (change.threadId) {
      const thread = env.THREAD.get(env.THREAD.idFromName(change.threadId));
      await thread.recordPayments(
        [
          {
            kind,
            userId: change.userId,
            amount: change.amount,
            ...(change.pactId ? { pactId: change.pactId } : {}),
            ...(change.paypalRef ? { paypalRef: change.paypalRef } : {}),
          },
        ],
        change.pactId && kind === "charged"
          ? { pactId: change.pactId, userId: change.userId, status: "charged" }
          : undefined,
      );
    }
    return;
  }
}

/** Capture resources carry their order id outside the typed schema. */
function relatedOrderId(raw: string): string | undefined {
  try {
    const json = JSON.parse(raw) as {
      resource?: { supplementary_data?: { related_ids?: { order_id?: unknown } } };
    };
    const id = json.resource?.supplementary_data?.related_ids?.order_id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** A refund's `up` link points at the capture it refunds. */
function upLinkId(r: { links?: { rel: string; href: string }[] }): string | undefined {
  const href = r.links?.find((l) => l.rel === "up")?.href;
  return href?.split("/").filter(Boolean).at(-1);
}
