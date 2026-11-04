/**
 * POST /webhooks/paypal. The PayPal signature is the authentication: verify the raw bytes,
 * then parse, then claim the event id (atomic), then dispatch. A dispatch failure releases
 * the claim and returns 500 so PayPal redelivers. PAYPAL_MODE=simulated skips verification.
 */
import { parseWebhookEvent, verifyWebhookSelf } from "@pact/paypal";
import { fromPayPalValue, type Money } from "@pact/protocol";
import { Hono } from "hono";
import { applyVoids } from "../credits";
import type { Env } from "../env";
import { applyBatchStatus } from "../payouts";
import { type CaptureFacts, readItems, recordCapture, shopOf } from "./join";

/** Programme deposits are Orders v2 captures too; they are money in, not sales. */
const isDeposit = (customId: string | undefined) => !!customId?.startsWith("cited-dep:");

const MAX_BODY = 256 * 1024;

export const webhooks = new Hono<{ Bindings: Env }>();

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : undefined;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const now = () => new Date().toISOString();

function money(v: unknown): Money | undefined {
  const a = obj(v);
  const value = str(a?.value);
  const cur = str(a?.currency_code);
  if (!value || !cur) return undefined;
  try {
    return fromPayPalValue(value, cur);
  } catch {
    return undefined;
  }
}

webhooks.post("/paypal", async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.json({ error: "too_large" }, 413);

  if (c.env.PAYPAL_MODE !== "simulated") {
    if (!c.env.PAYPAL_WEBHOOK_ID) return c.json({ error: "paypal_unavailable" }, 503);
    const verified = await verifyWebhookSelf({
      env: c.env.PAYPAL_MODE === "live" ? "live" : "sandbox",
      webhookId: c.env.PAYPAL_WEBHOOK_ID,
      headers: c.req.raw.headers,
      rawBody: raw,
    });
    if (!verified.ok) return c.json({ error: verified.reason }, 400);
  }

  let parsed: ReturnType<typeof parseWebhookEvent>;
  try {
    parsed = parseWebhookEvent(raw);
  } catch {
    return c.json({ error: "invalid_event" }, 400);
  }
  const id = parsed.known ? parsed.event.id : parsed.id;
  const type = parsed.known ? parsed.event.event_type : parsed.eventType;

  const claim = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO webhook_events (id, event_type, received_at) VALUES (?, ?, ?)",
  )
    .bind(id, type, now())
    .run();
  if (claim.meta.changes === 0) return c.json({ ok: true, duplicate: true });

  try {
    const envelope = JSON.parse(raw) as Raw;
    const handled = await dispatch(c.env, id, type, obj(envelope.resource) ?? {});
    if (!handled) console.log("webhook: ignored event type", type);
  } catch (err) {
    console.error("webhook dispatch failed", type, (err as Error)?.name);
    await c.env.DB.prepare("DELETE FROM webhook_events WHERE id = ?").bind(id).run();
    return c.json({ error: "retry" }, 500);
  }
  return c.json({ ok: true });
});

async function dispatch(env: Env, eventId: string, type: string, r: Raw): Promise<boolean> {
  switch (type) {
    case "CHECKOUT.ORDER.APPROVED": {
      const orderId = str(r.id);
      const unit = obj((Array.isArray(r.purchase_units) ? r.purchase_units : [])[0]);
      if (!orderId || !unit || isDeposit(str(unit.custom_id))) return true;
      await env.DB.prepare(
        `INSERT INTO orders (order_id, custom_id, shop_id, items_json, approved_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (order_id) DO UPDATE SET custom_id = excluded.custom_id,
           shop_id = excluded.shop_id, items_json = excluded.items_json`,
      )
        .bind(
          orderId,
          str(unit.custom_id) ?? null,
          shopOf(unit),
          JSON.stringify(readItems(unit.items)),
          now(),
        )
        .run();
      return true;
    }
    case "PAYMENT.CAPTURE.COMPLETED": {
      const captureId = str(r.id);
      const orderId = str(obj(obj(r.supplementary_data)?.related_ids)?.order_id);
      if (!captureId || !orderId) return true;
      const facts: CaptureFacts = {
        captureId,
        orderId,
        capturedAt: str(r.create_time) ?? now(),
        items: readItems(r.items),
      };
      const customId = str(r.custom_id);
      if (isDeposit(customId)) return true;
      const amount = money(r.amount);
      if (customId) facts.customId = customId;
      if (amount) facts.amount = amount;
      await recordCapture(env, facts);
      return true;
    }
    case "PAYMENT.CAPTURE.REFUNDED": {
      // The resource is the refund; its `up` link points at the capture.
      const links = Array.isArray(r.links) ? (r.links as Raw[]) : [];
      const up = str(links.find((l) => l.rel === "up")?.href);
      const captureId = up?.split("/").filter(Boolean).at(-1);
      const refundId = str(r.id);
      if (!captureId || !refundId) return true;
      await storeRefund(env, {
        id: refundId,
        captureId,
        kind: "refund",
        status: str(r.status) ?? "COMPLETED",
        amount: money(r.amount),
        eventId,
      });
      return true;
    }
    case "PAYMENT.CAPTURE.REVERSED":
    case "CUSTOMER.DISPUTE.CREATED":
    case "CUSTOMER.DISPUTE.UPDATED":
    case "CUSTOMER.DISPUTE.RESOLVED": {
      const disputeId = str(r.dispute_id) ?? str(r.id);
      const txs = Array.isArray(r.disputed_transactions) ? (r.disputed_transactions as Raw[]) : [];
      const captureId = str(txs[0]?.seller_transaction_id);
      if (!disputeId || !captureId) return true;
      await storeRefund(env, {
        id: disputeId,
        captureId,
        kind: "dispute",
        status: str(r.status) ?? type.split(".").at(-1) ?? "UNKNOWN",
        amount: money(r.dispute_amount),
        eventId,
      });
      return true;
    }
    case "PAYMENT.PAYOUTSBATCH.PROCESSING":
    case "PAYMENT.PAYOUTSBATCH.SUCCESS":
    case "PAYMENT.PAYOUTSBATCH.DENIED": {
      const header = obj(r.batch_header);
      const batchId = str(header?.payout_batch_id);
      const status = str(header?.batch_status);
      if (batchId && status) await applyBatchStatus(env, batchId, status);
      return true;
    }
    default:
      return false;
  }
}

async function storeRefund(
  env: Env,
  x: {
    id: string;
    captureId: string;
    kind: "refund" | "dispute";
    status: string;
    amount: Money | undefined;
    eventId: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO refunds (id, capture_id, kind, status, amount_minor, currency, event_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status, event_id = excluded.event_id,
       amount_minor = COALESCE(excluded.amount_minor, amount_minor),
       currency = COALESCE(excluded.currency, currency)`,
  )
    .bind(
      x.id,
      x.captureId,
      x.kind,
      x.status,
      x.amount?.amountMinor ?? null,
      x.amount?.currency ?? null,
      x.eventId,
      now(),
    )
    .run();
  await applyVoids(env, x.captureId);
}
