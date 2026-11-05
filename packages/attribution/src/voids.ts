import type { Credit, Money } from "@pact/protocol";
import { divRound } from "./ledger";

export type VoidEvent =
  | { kind: "refund"; captureId: string }
  | {
      kind: "partial_refund";
      captureId: string;
      saleAmount: Money;
      /** This refund event. */
      refunded: Money;
      /** Total refunded on the capture so far; defaults to `refunded`. Makes redelivery a no-op. */
      cumulativeRefunded?: Money;
    }
  | { kind: "dispute"; captureId: string };

/** A credit that was already paid when its sale was refunded or disputed. A person reviews it. */
export interface ReviewFlag {
  creditId: string;
  captureId: string;
  reason: VoidEvent["kind"];
  payoutBatchId?: string | undefined;
}

export interface VoidResult {
  credits: Credit[];
  flags: ReviewFlag[];
}

/** Split `total` across `weights` proportionally, exactly, by largest remainder (ties by index). */
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  if (total > sum) throw new Error("cannot apportion more than the weights total");
  const quotas = weights.map((w, i) => {
    const num = total * w;
    return { i, floor: Math.floor(num / sum), rem: num % sum };
  });
  let left = total - quotas.reduce((a, q) => a + q.floor, 0);
  for (const q of [...quotas].sort((a, b) => b.rem - a.rem || a.i - b.i)) {
    if (left <= 0) break;
    q.floor += 1;
    left -= 1;
  }
  return quotas.map((q) => q.floor);
}

const voidWhole = (c: Credit, reason: Credit["voidReason"]): Credit => ({
  ...c,
  state: "voided",
  voidReason: reason,
});

/**
 * Apply a refund or dispute to the ledger. Pure and idempotent: a redelivered webhook
 * changes nothing. Pending credits void (fully, or proportionally for a partial refund);
 * paid credits are flagged for review and left exactly as they are.
 */
export function applyVoid(credits: readonly Credit[], event: VoidEvent): VoidResult {
  const forSale = credits.filter((c) => c.captureId === event.captureId);
  const flags: ReviewFlag[] = forSale
    .filter((c) => c.state === "paid")
    .map((c) => ({
      creditId: c.id,
      captureId: c.captureId,
      reason: event.kind,
      payoutBatchId: c.payoutBatchId,
    }));

  const fullReason = event.kind === "dispute" ? "dispute" : "refund";
  const isFull =
    event.kind !== "partial_refund" ||
    (event.cumulativeRefunded ?? event.refunded).amountMinor >= event.saleAmount.amountMinor;

  if (isFull) {
    return {
      credits: credits.map((c) =>
        c.captureId === event.captureId && c.state === "pending" ? voidWhole(c, fullReason) : c,
      ),
      flags,
    };
  }

  const pending = forSale
    .filter((c) => c.state === "pending")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const already = forSale
    .filter((c) => c.state === "voided" && c.voidReason === "partial_refund")
    .reduce((a, c) => a + c.amount.amountMinor, 0);
  const pendingSum = pending.reduce((a, c) => a + c.amount.amountMinor, 0);
  const cum = (event.cumulativeRefunded ?? event.refunded).amountMinor;
  const target = divRound((pendingSum + already) * cum, event.saleAmount.amountMinor);
  const additional = Math.min(pendingSum, Math.max(0, target - already));
  if (additional === 0) return { credits: [...credits], flags };

  const shares = apportion(
    additional,
    pending.map((c) => c.amount.amountMinor),
  );
  const byId = new Map(pending.map((c, i) => [c.id, shares[i] ?? 0]));
  const out: Credit[] = [];
  for (const c of credits) {
    const v = byId.get(c.id);
    if (!v) {
      out.push(c);
    } else if (v >= c.amount.amountMinor) {
      out.push(voidWhole(c, "partial_refund"));
    } else {
      const seq = credits.filter((x) => x.id.startsWith(`${c.id}~v`)).length + 1;
      out.push({ ...c, amount: { ...c.amount, amountMinor: c.amount.amountMinor - v } });
      out.push({
        ...c,
        id: `${c.id}~v${seq}`,
        amount: { ...c.amount, amountMinor: v },
        state: "voided",
        voidReason: "partial_refund",
      });
    }
  }
  return { credits: out, flags };
}
