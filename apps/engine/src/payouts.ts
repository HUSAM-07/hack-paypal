import { markPaid, releasePayable } from "@pact/attribution";
import { PayPalError } from "@pact/paypal";
import { nowOf } from "./clock";
import { loadCredits, persistCredits } from "./credits";
import type { Env } from "./env";
import { getPayPal } from "./paypal";

type Row = Record<string, unknown>;

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface PayoutRun {
  now: string;
  status: "nothing_due" | "sent";
  senderBatchId?: string;
  paypalBatchId?: string;
  batchStatus?: string;
  items: {
    creatorId: string;
    receiver: string;
    amountMinor: number;
    currency: string;
    creditIds: string[];
  }[];
  /** Creators with due credits but no PayPal account on file; their credits stay pending. */
  skipped: { creatorId: string; amountMinor: number; reason: "no_paypal_id" }[];
}

/**
 * Pay every credit whose hold has ended in ONE batch Payouts call (PAYPAL_ID recipients,
 * one item per creator). The batch id is a hash of the credit ids, so a retry sends the
 * same `sender_batch_id` and `PayPal-Request-Id` and can never double-pay.
 */
export async function runPayouts(env: Env): Promise<PayoutRun> {
  const now = await nowOf(env);
  const credits = await loadCredits(env);
  const lines = releasePayable(credits, now);
  const run: PayoutRun = { now, status: "nothing_due", items: [], skipped: [] };

  const payable = [];
  for (const line of lines) {
    const c = await env.DB.prepare("SELECT paypal_id FROM creators WHERE creator_id = ?")
      .bind(line.creatorId)
      .first<{ paypal_id: string | null }>();
    if (!c?.paypal_id) {
      run.skipped.push({
        creatorId: line.creatorId,
        amountMinor: line.gross.amountMinor,
        reason: "no_paypal_id",
      });
      continue;
    }
    payable.push({ line, receiver: c.paypal_id });
  }
  if (payable.length === 0) return run;

  const creditIds = payable.flatMap((p) => p.line.creditIds).sort();
  const senderBatchId = `cited-${(await sha256Hex(creditIds.join(","))).slice(0, 32)}`;
  const items = payable.map((p) => ({
    recipient_type: "PAYPAL_ID" as const,
    receiver: p.receiver,
    amount: p.line.gross,
    sender_item_id: senderItemId(p.line.creatorId, senderBatchId),
    note: "CITED: commission on sales your test caused",
  }));
  run.items = payable.map((p) => ({
    creatorId: p.line.creatorId,
    receiver: p.receiver,
    amountMinor: p.line.gross.amountMinor,
    currency: p.line.currency,
    creditIds: p.line.creditIds,
  }));
  run.senderBatchId = senderBatchId;

  const prior = await env.DB.prepare(
    "SELECT paypal_batch_id, status FROM payout_batches WHERE sender_batch_id = ?",
  )
    .bind(senderBatchId)
    .first<{ paypal_batch_id: string | null; status: string }>();

  let paypalBatchId = prior?.paypal_batch_id ?? undefined;
  let batchStatus = prior?.status ?? "PENDING";
  if (!paypalBatchId) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO payout_batches (sender_batch_id, status, items_json, credit_ids_json, created_at)
       VALUES (?, 'SENDING', ?, ?, ?)`,
    )
      .bind(senderBatchId, JSON.stringify(run.items), JSON.stringify(creditIds), now)
      .run();
    const { paypal } = getPayPal(env);
    try {
      const created = await paypal.payouts.createBatch(
        {
          sender_batch_header: {
            sender_batch_id: senderBatchId,
            recipient_type: "PAYPAL_ID",
            email_subject: "You earned CITED commission",
          },
          items,
        },
        { requestId: `cited-payout:${senderBatchId}` },
      );
      paypalBatchId = created.batch_header.payout_batch_id;
      batchStatus = created.batch_header.batch_status;
    } catch (err) {
      // A reused sender_batch_id means PayPal already has this batch: never send it twice.
      const dup =
        err instanceof PayPalError && err.details.some((d) => d.issue === "DUPLICATE_BATCH");
      if (!dup) throw err;
      batchStatus = "PENDING";
    }
    await env.DB.prepare(
      "UPDATE payout_batches SET paypal_batch_id = ?, status = ? WHERE sender_batch_id = ?",
    )
      .bind(paypalBatchId ?? null, batchStatus, senderBatchId)
      .run();
  }

  const ledger = markPaid(credits, creditIds, paypalBatchId ?? senderBatchId);
  await persistCredits(env, credits, ledger, now);
  await setPayoutStatus(env, paypalBatchId ?? senderBatchId, batchStatus);
  await refreshPayouts(env);

  const final = await env.DB.prepare("SELECT status FROM payout_batches WHERE sender_batch_id = ?")
    .bind(senderBatchId)
    .first<{ status: string }>();
  run.status = "sent";
  if (paypalBatchId) run.paypalBatchId = paypalBatchId;
  run.batchStatus = final?.status ?? batchStatus;
  return run;
}

async function setPayoutStatus(env: Env, batchId: string, status: string): Promise<void> {
  await env.DB.prepare("UPDATE credits SET payout_status = ? WHERE payout_batch_id = ?")
    .bind(status, batchId)
    .run();
}

/**
 * Apply a batch status from PayPal (webhook or poll). Credits stay paid while the batch is
 * pending or succeeded; a denied or cancelled batch puts them back to pending for a retry.
 */
export async function applyBatchStatus(
  env: Env,
  paypalBatchId: string,
  status: string,
): Promise<void> {
  const done = await env.DB.prepare(
    "SELECT 1 AS ok FROM payout_batches WHERE paypal_batch_id = ? AND status = 'SUCCESS'",
  )
    .bind(paypalBatchId)
    .first();
  if (done) return; // events can arrive out of order; SUCCESS is final
  await env.DB.prepare("UPDATE payout_batches SET status = ? WHERE paypal_batch_id = ?")
    .bind(status, paypalBatchId)
    .run();
  if (status === "DENIED" || status === "CANCELED") {
    await env.DB.prepare(
      `UPDATE credits SET state = 'pending', payout_batch_id = NULL, payout_status = ?
       WHERE payout_batch_id = ? AND state = 'paid'`,
    )
      .bind(status, paypalBatchId)
      .run();
    return;
  }
  await setPayoutStatus(env, paypalBatchId, status);
}

/** Deterministic per-creator item id inside a batch (the console mirrors this rule). */
export function senderItemId(creatorId: string, senderBatchId: string): string {
  return `${creatorId}-${senderBatchId.slice(6, 14)}`.slice(0, 63);
}

/**
 * PayPal's payout_item_id per sender_item_id for one batch. Best-effort: the read API must
 * still answer if PayPal is unreachable, so failures return an empty map.
 */
export async function payoutItemIds(env: Env, paypalBatchId: string): Promise<Map<string, string>> {
  try {
    const { paypal } = getPayPal(env);
    const batch = await paypal.payouts.getBatch(paypalBatchId, { page_size: 100 });
    return new Map(
      batch.items
        .filter((i) => i.payout_item.sender_item_id)
        .map((i) => [i.payout_item.sender_item_id as string, i.payout_item_id]),
    );
  } catch {
    return new Map();
  }
}

/** Poll PayPal for batches that have not finished and store their status on the ledger. */
export async function refreshPayouts(env: Env): Promise<void> {
  const open = (
    await env.DB.prepare(
      `SELECT paypal_batch_id FROM payout_batches
       WHERE paypal_batch_id IS NOT NULL AND status NOT IN ('SUCCESS', 'DENIED', 'CANCELED')`,
    ).all<Row>()
  ).results;
  if (open.length === 0) return;
  const { paypal } = getPayPal(env);
  for (const r of open) {
    const id = r.paypal_batch_id as string;
    const batch = await paypal.payouts.getBatch(id, { page_size: 1 });
    await applyBatchStatus(env, id, batch.batch_header.batch_status);
  }
}
