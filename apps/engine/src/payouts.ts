import { markPaid, releasePayable } from "@pact/attribution";
import { PayPalError } from "@pact/paypal";
import { nowOf } from "./clock";
import { frozenCaptures, loadCredits, persistCredits } from "./credits";
import type { Env } from "./env";
import { applyGuard, heldCredits } from "./guard";
import { VENMO_CURRENCY, VENMO_NOTE, type VenmoReceiver, venmoLabel } from "./payout-method";
import { loadWallets } from "./payout-wallet";
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
    /** The PayPal payer id, or for a Venmo item a masked label (`Venmo ···0123`). */
    receiver: string;
    /** Where this item was sent. Absent means PayPal, as every item was before Venmo. */
    wallet?: "VENMO";
    amountMinor: number;
    currency: string;
    creditIds: string[];
  }[];
  /** Creators with due credits but no PayPal account on file; their credits stay pending. */
  skipped: { creatorId: string; amountMinor: number; reason: "no_paypal_id" }[];
  /** Every batch this run sent (more than one only past PAYOUT_BATCH_MAX_ITEMS creators). */
  batches: PayoutBatchRun[];
  /** Credits past their hold that the abuse guard keeps for a reviewer: never in this batch. */
  held: { creditId: string; creatorId: string; amountMinor: number }[];
}

/**
 * PayPal Payouts takes at most 15,000 items in one `POST /v1/payments/payouts` call; a larger
 * run is split into several batches.
 */
export const PAYOUT_BATCH_MAX_ITEMS = 15_000;

export interface PayoutBatchRun {
  senderBatchId: string;
  paypalBatchId?: string;
  batchStatus?: string;
  items: number;
}

/**
 * Pay every credit whose hold has ended (and whose sale is not under an open dispute) by batch
 * Payouts (PAYPAL_ID recipients, one item per creator): one batch up to PAYOUT_BATCH_MAX_ITEMS
 * creators, more beyond. Each batch id is a hash of its credit ids, so a retry sends the same
 * `sender_batch_id` and `PayPal-Request-Id` and can never double-pay.
 */
export async function runPayouts(env: Env, maxItems = PAYOUT_BATCH_MAX_ITEMS): Promise<PayoutRun> {
  const now = await nowOf(env);
  // The guard runs first, so nothing it would hold can slip into this batch.
  await applyGuard(env, now);
  const credits = await loadCredits(env);
  const held = await heldCredits(env);
  const lines = releasePayable(credits, now, undefined, await frozenCaptures(env), held);
  const byId = new Map(credits.map((c) => [c.id, c]));
  const run: PayoutRun = {
    now,
    status: "nothing_due",
    items: [],
    skipped: [],
    batches: [],
    held: releasePayable(credits, now, 0)
      .flatMap((l) => l.creditIds)
      .filter((id) => held.has(id))
      .map((id) => {
        const c = byId.get(id) as (typeof credits)[number];
        return { creditId: id, creatorId: c.creatorId, amountMinor: c.amount.amountMinor };
      }),
  };

  // One read for every receiver, not one per creator.
  const wallets = await loadWallets(env);
  const payable: Payable[] = [];
  for (const line of lines) {
    const w = wallets.get(line.creatorId);
    const receiver = w?.paypalId;
    // Venmo takes US dollars only: any other currency goes to the creator's PayPal account.
    const venmo = w?.venmo && line.currency === VENMO_CURRENCY ? w.venmo : undefined;
    if (!receiver) {
      run.skipped.push({
        creatorId: line.creatorId,
        amountMinor: line.gross.amountMinor,
        reason: "no_paypal_id",
      });
      continue;
    }
    payable.push({ line, receiver, ...(venmo ? { venmo } : {}) });
  }
  if (payable.length === 0) return run;

  run.items = payable.map((p) => ({
    creatorId: p.line.creatorId,
    receiver: p.venmo ? venmoLabel(p.venmo) : p.receiver,
    ...(p.venmo ? { wallet: "VENMO" as const } : {}),
    amountMinor: p.line.gross.amountMinor,
    currency: p.line.currency,
    creditIds: p.line.creditIds,
  }));

  let ledger = credits;
  for (let i = 0; i < payable.length; i += maxItems) {
    const chunk = payable.slice(i, i + maxItems);
    const creditIds = chunk.flatMap((p) => p.line.creditIds).sort();
    const sent = await sendBatch(env, chunk, creditIds, now);
    ledger = markPaid(ledger, creditIds, sent.paypalBatchId ?? sent.senderBatchId);
    run.batches.push(sent);
  }
  await persistCredits(env, credits, ledger, now);
  for (const b of run.batches)
    await setPayoutStatus(env, b.paypalBatchId ?? b.senderBatchId, b.batchStatus ?? "PENDING");
  await refreshPayouts(env);

  for (const b of run.batches) {
    const final = await env.DB.prepare(
      "SELECT status FROM payout_batches WHERE sender_batch_id = ?",
    )
      .bind(b.senderBatchId)
      .first<{ status: string }>();
    if (final?.status) b.batchStatus = final.status;
  }
  const first = run.batches[0] as PayoutBatchRun;
  run.status = "sent";
  run.senderBatchId = first.senderBatchId;
  if (first.paypalBatchId) run.paypalBatchId = first.paypalBatchId;
  if (first.batchStatus) run.batchStatus = first.batchStatus;
  return run;
}

interface Payable {
  line: ReturnType<typeof releasePayable>[number];
  /** The creator's PayPal payer id: the default destination and the fallback. */
  receiver: string;
  venmo?: VenmoReceiver;
}

/**
 * One payout item. PayPal creators get `PAYPAL_ID` as always; a Venmo creator gets the item PayPal's
 * "Payouts to Venmo" guide describes (`recipient_wallet: VENMO`, PHONE or USER_HANDLE, a note).
 * Both kinds ride in one batch: each item carries its own `recipient_type`, which overrides the header.
 */
export function payoutItem(p: Payable, senderBatchId: string) {
  const base = {
    amount: p.line.gross,
    sender_item_id: senderItemId(p.line.creatorId, senderBatchId, p.line.currency),
    note: VENMO_NOTE,
  };
  return p.venmo
    ? {
        recipient_type: p.venmo.type,
        receiver: p.venmo.receiver,
        recipient_wallet: "VENMO" as const,
        ...base,
      }
    : { recipient_type: "PAYPAL_ID" as const, receiver: p.receiver, ...base };
}

/** Create (or find, on a retry) one Payouts batch for these creators' due credits. */
async function sendBatch(
  env: Env,
  chunk: Payable[],
  creditIds: string[],
  now: string,
): Promise<PayoutBatchRun> {
  const senderBatchId = `cited-${(await sha256Hex(creditIds.join(","))).slice(0, 32)}`;
  const items = chunk.map((p) => payoutItem(p, senderBatchId));
  // What is stored and shown never holds a Venmo phone number: a masked label instead.
  const stored = chunk.map((p) => ({
    creatorId: p.line.creatorId,
    receiver: p.venmo ? venmoLabel(p.venmo) : p.receiver,
    ...(p.venmo ? { wallet: "VENMO" } : {}),
    amountMinor: p.line.gross.amountMinor,
    currency: p.line.currency,
    creditIds: p.line.creditIds,
  }));

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
      .bind(senderBatchId, JSON.stringify(stored), JSON.stringify(creditIds), now)
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
  return {
    senderBatchId,
    ...(paypalBatchId ? { paypalBatchId } : {}),
    batchStatus,
    items: chunk.length,
  };
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

/**
 * Deterministic per-creator item id inside a batch (the console mirrors this rule). A batch can
 * carry one item per creator per currency (each item has its own currency), so a non-USD item's
 * id ends in its currency: unique in the batch, and USD ids are exactly what they always were.
 */
export function senderItemId(
  creatorId: string,
  senderBatchId: string,
  currency: string = "USD",
): string {
  const base = `${creatorId}-${senderBatchId.slice(6, 14)}`;
  return (currency === "USD" ? base : `${base}-${currency}`).slice(0, 63);
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
