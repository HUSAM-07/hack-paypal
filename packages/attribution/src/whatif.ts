import type { AttributedSale, Credit, Money, ProgrammeDeposit } from "@pact/protocol";
import { settleDeposit } from "./deposit";
import { createCredits, divRound } from "./ledger";
import { coalitionValueFrom } from "./shapley";

/**
 * The commission what-if: the ledger's own maths (`createCredits`, `settleDeposit`) run again
 * on a brand's recorded sales with a different commission rate or deposit. Pure and read-only:
 * it builds a fresh list of credits in memory and never touches the real ledger.
 */

/** What the engine's read API recorded for one brand: the inputs `createCredits` needs. */
export interface WhatIfBrand {
  brandId: string;
  upc: string;
  currency: string;
  /** Whole units the lift verdict credits. The commission rate does not move it. */
  causedUnits: number;
  /** Exposed-arm sales of this SKU, outside the abuse guard's self-purchase hold. */
  sales: readonly AttributedSale[];
  /** Exposed-arm sales the guard keeps apart (credited in full, then held for review). */
  selfDealtSales: readonly AttributedSale[];
  /** Lift of each coalition of creators, keyed by sorted ids joined with "+" (see `coalitionValueFrom`). */
  coalitions: Readonly<Record<string, number>>;
}

export interface WhatIfSettings {
  /** Commission rate in basis points (800 = 8%). */
  commissionBps: number;
  /** Deposit the credits may draw on, in minor units. */
  depositMinor: number;
}

export interface WhatIfLedger {
  /** The real ledger's state for each credit id; ids it does not know stay pending. */
  states?: ReadonlyMap<string, Credit["state"]>;
  /** Count only these credit ids (the first payout's cycle). Omit for the whole programme. */
  inScope?: ReadonlySet<string>;
}

export interface WhatIfCreator {
  creatorId: string;
  credited: Money;
  voided: Money;
  /** Credited minus voided: paid, or still to be paid. */
  kept: Money;
}

export interface WhatIfResult {
  credits: Credit[];
  creators: WhatIfCreator[];
  /** Sales of the study that earned a credit. A held self-purchase is not one of them. */
  causedUnits: number;
  credited: Money;
  voided: Money;
  /** Credited minus voided. */
  kept: Money;
  /** What the study's credits kept, spread over `causedUnits`, to the nearest cent; null with none. */
  costPerCausedSale: Money | null;
  /** The unspent part of the deposit that goes back to the brand. */
  refunded: Money;
}

const money = (amountMinor: number, currency: string): Money => ({ amountMinor, currency });

/** Run the brand's credits again at another commission rate and deposit. */
export function commissionWhatIf(
  brand: WhatIfBrand,
  settings: WhatIfSettings,
  ledger: WhatIfLedger = {},
): WhatIfResult {
  const cur = brand.currency;
  const deposit: ProgrammeDeposit = {
    id: `what-if-${brand.brandId}`,
    brandId: brand.brandId,
    category: "what-if",
    captureId: "what-if",
    deposited: money(settings.depositMinor, cur),
    spent: money(0, cur),
    returned: money(0, cur),
  };
  const value = coalitionValueFrom({ "": 0, ...brand.coalitions });
  const base = { commissionBps: settings.commissionBps, coalitionValue: () => value };
  // Same order as the engine: the study's sales first, then the held self-purchases from what is left.
  const main = createCredits({
    ...base,
    sales: brand.sales,
    brands: [{ brandId: brand.brandId, upc: brand.upc, units: brand.causedUnits, deposit }],
  });
  const apart = createCredits({
    ...base,
    sales: brand.selfDealtSales,
    brands: [
      { brandId: brand.brandId, upc: brand.upc, units: brand.selfDealtSales.length, deposit },
    ],
    existing: main,
  });
  const credits = [...main, ...apart]
    .filter((c) => !ledger.inScope || ledger.inScope.has(c.id))
    .map((c): Credit => ({ ...c, state: ledger.states?.get(c.id) ?? "pending" }));

  const sum = (cs: readonly Credit[]) => cs.reduce((a, c) => a + c.amount.amountMinor, 0);
  const voidedCredits = credits.filter((c) => c.state === "voided");
  const creators = [...new Set(credits.map((c) => c.creatorId))].sort().map((creatorId) => {
    const mine = credits.filter((c) => c.creatorId === creatorId);
    const voided = sum(mine.filter((c) => c.state === "voided"));
    return {
      creatorId,
      credited: money(sum(mine), cur),
      voided: money(voided, cur),
      kept: money(sum(mine) - voided, cur),
    };
  });
  const studyIds = new Set(main.map((c) => c.id));
  const study = credits.filter((c) => studyIds.has(c.id));
  const causedUnits = new Set(study.map((c) => c.captureId)).size;
  const kept = sum(credits) - sum(voidedCredits);
  const studyKept = sum(study) - sum(study.filter((c) => c.state === "voided"));
  return {
    credits,
    creators,
    causedUnits,
    credited: money(sum(credits), cur),
    voided: money(sum(voidedCredits), cur),
    kept: money(kept, cur),
    costPerCausedSale: causedUnits > 0 ? money(divRound(studyKept, causedUnits), cur) : null,
    refunded: settleDeposit(
      deposit,
      credits.filter((c) => c.state !== "voided"),
    ).returnedNow,
  };
}
