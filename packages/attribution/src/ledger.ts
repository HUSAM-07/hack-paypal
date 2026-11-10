import {
  type AttributedSale,
  COMMISSION_BPS,
  type Credit,
  HOLD_DAYS,
  type Money,
  type ProgrammeDeposit,
} from "@pact/protocol";
import { MS_PER_DAY, toDate } from "./clock";
import { depositBalance } from "./deposit";
import { type CoalitionValue, splitCommission } from "./shapley";

/**
 * PayPal's network fee on paid commissions, in basis points (2.00%). A demo assumption,
 * not a PayPal rate: change it here or pass `feeBps`. It is charged to the brand on top of
 * the commission, never taken from the deposit or from the creator's payout, so the creator
 * receives the full credit and the deposit reconciles to the cent.
 */
export const DEFAULT_NETWORK_FEE_BPS = 200;

export const holdUntilFor = (capturedAt: string, holdDays = HOLD_DAYS): string =>
  new Date(toDate(capturedAt).getTime() + holdDays * MS_PER_DAY).toISOString();

/** round(n/d) half-up, integers only. */
export const divRound = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d));

/** Network fee on a payout, rounded to the nearest minor unit. */
export function networkFee(gross: Money, feeBps = DEFAULT_NETWORK_FEE_BPS): Money {
  if (!Number.isInteger(feeBps) || feeBps < 0)
    throw new Error("feeBps must be a non-negative integer");
  return { amountMinor: divRound(gross.amountMinor * feeBps, 10_000), currency: gross.currency };
}

export interface BrandProgramme {
  brandId: string;
  /** The brand's SKU; only exposed-arm sales of this UPC can be credited. */
  upc: string;
  /** Whole units the lift result credited (`creditBrand(...).units`). */
  units: number;
  deposit: ProgrammeDeposit;
}

export interface CreateCreditsInput {
  sales: readonly AttributedSale[];
  brands: readonly BrandProgramme[];
  /** Lift of each coalition of co-exposed creators for this sale, for the Shapley split. */
  coalitionValue: (sale: AttributedSale) => CoalitionValue;
  /** Credits already on the ledger: counted against deposits and never re-created. */
  existing?: readonly Credit[];
  holdDays?: number;
}

/**
 * Turn lifted units into pending credits.
 *
 * Per brand: take the first `units` exposed sales of its SKU (by capture time, then id),
 * so a brand only ever pays for its own SKU's lift. Each sale's 8% commission is rounded
 * cumulatively to the nearest cent (so 102 × $95.99 × 8% = $783.28, one rounding for the
 * batch, not 102), capped by what is left of the brand's deposit, then Shapley-split across
 * the creators the session saw. Credits start `pending` and are held until capture + 30 days.
 */
export function createCredits(input: CreateCreditsInput): Credit[] {
  const existing = input.existing ?? [];
  const have = new Set(existing.map((c) => c.id));
  const out: Credit[] = [];

  for (const brand of input.brands) {
    if (!Number.isInteger(brand.units) || brand.units < 0)
      throw new Error("units must be a non-negative integer");
    const cur = brand.deposit.deposited.currency;
    let budget = depositBalance(brand.deposit, [...existing, ...out]).available.amountMinor;

    const eligible = input.sales
      .filter((s) => s.arm === "test" && s.upc === brand.upc)
      .sort((a, b) =>
        a.capturedAt < b.capturedAt
          ? -1
          : a.capturedAt > b.capturedAt
            ? 1
            : a.captureId < b.captureId
              ? -1
              : 1,
      )
      .slice(0, brand.units);

    let numerator = 0; // Σ amount·bps so far; commission rounds on the running total
    let allocated = 0;
    for (const sale of eligible) {
      if (sale.amount.currency !== cur) throw new Error(`currency mismatch for ${sale.captureId}`);
      numerator += sale.amount.amountMinor * COMMISSION_BPS;
      const target = divRound(numerator, 10_000);
      const exact = target - allocated;
      allocated = target;
      const commission = Math.min(exact, budget);
      if (commission <= 0 || sale.creatorsSeen.length === 0) continue;

      const split = splitCommission(
        { amountMinor: commission, currency: cur },
        sale.creatorsSeen,
        input.coalitionValue(sale),
      );
      for (const [creatorId, share] of split) {
        if (share.amountMinor === 0) continue;
        const id = `${sale.captureId}:${creatorId}`;
        if (have.has(id)) continue;
        have.add(id);
        budget -= share.amountMinor;
        out.push({
          id,
          captureId: sale.captureId,
          creatorId,
          brandId: brand.brandId,
          upc: sale.upc,
          amount: share,
          state: "pending",
          holdUntil: holdUntilFor(sale.capturedAt, input.holdDays),
        });
      }
    }
  }
  return out;
}

export interface PayoutLine {
  creatorId: string;
  currency: string;
  creditIds: string[];
  gross: Money;
  /** PayPal's network fee on this payout; recorded, billed to the brand, not deducted from `gross`. */
  fee: Money;
}

/**
 * Pending credits whose hold has ended, grouped per creator (and currency), ready for a batch
 * payout. Credits on a capture in `frozenCaptures` (an open dispute) stay pending until PayPal
 * decides it: released if the seller wins, voided if the buyer does. Credits in `heldCredits`
 * (an open guard hold, see guard.ts) stay pending until a reviewer releases or voids them.
 */
export function releasePayable(
  credits: readonly Credit[],
  now: string | Date,
  feeBps = DEFAULT_NETWORK_FEE_BPS,
  frozenCaptures: ReadonlySet<string> = new Set(),
  heldCredits: ReadonlySet<string> = new Set(),
): PayoutLine[] {
  const t = toDate(now).getTime();
  const groups = new Map<string, Credit[]>();
  for (const c of credits) {
    if (c.state !== "pending" || toDate(c.holdUntil).getTime() > t) continue;
    if (frozenCaptures.has(c.captureId) || heldCredits.has(c.id)) continue;
    const key = `${c.creatorId}|${c.amount.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, list]) => {
      const currency = list[0]?.amount.currency ?? "USD";
      const gross = { amountMinor: list.reduce((a, c) => a + c.amount.amountMinor, 0), currency };
      return {
        creatorId: list[0]?.creatorId ?? "",
        currency,
        creditIds: list.map((c) => c.id).sort(),
        gross,
        fee: networkFee(gross, feeBps),
      };
    });
}

/** Mark released credits paid under one payout batch. Only pending credits change. */
export function markPaid(
  credits: readonly Credit[],
  creditIds: readonly string[],
  payoutBatchId: string,
): Credit[] {
  const ids = new Set(creditIds);
  return credits.map((c) =>
    ids.has(c.id) && c.state === "pending" ? { ...c, state: "paid", payoutBatchId } : c,
  );
}
