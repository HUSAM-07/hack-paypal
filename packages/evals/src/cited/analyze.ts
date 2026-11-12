import { type ArmCounts, computeLift, creditBrand, type LiftResult } from "@pact/attribution";
import type { Money } from "@pact/protocol";
import type { Variant } from "./design";
import type { EvalArm, PriceCondition, StudyId } from "./world";

export interface Outcome {
  action: "buy" | "decline" | "invalid";
  shopId?: string;
  upc?: string;
  priceOk?: boolean;
  reason?: string;
  attempts: number;
  error?: string;
}

export interface SessionRecord {
  id: string;
  price?: PriceCondition;
  study: StudyId;
  variant: Variant;
  model: string;
  arm: EvalArm;
  intent: number;
  outcome: Outcome;
}

export interface Cell {
  sessions: number;
  target: number;
  buyers: number;
  declines: number;
}

const empty = (): Cell => ({ sessions: 0, target: 0, buyers: 0, declines: 0 });

export function tally(
  records: SessionRecord[],
  targetUpc: string,
): Map<string, Map<EvalArm, Cell>> {
  const byModel = new Map<string, Map<EvalArm, Cell>>();
  for (const r of records) {
    if (r.outcome.action === "invalid") continue;
    const arms = byModel.get(r.model) ?? new Map<EvalArm, Cell>();
    byModel.set(r.model, arms);
    const c = arms.get(r.arm) ?? empty();
    arms.set(r.arm, c);
    c.sessions++;
    if (r.outcome.action === "buy") {
      c.buyers++;
      if (r.outcome.upc === targetUpc) c.target++;
    } else c.declines++;
  }
  return byModel;
}

const cellOf = (m: Map<EvalArm, Cell> | undefined, arm: EvalArm): Cell => m?.get(arm) ?? empty();
const counts = (c: Cell, basis: "sessions" | "buyers"): ArmCounts => ({
  sessions: basis === "sessions" ? c.sessions : c.buyers,
  purchases: c.target,
});

export interface Analysis {
  lift: LiftResult;
  /** Pooled arm tallies across models. */
  pooled: { [A in EvalArm]: Cell };
  byModel: Array<{ model: string; test: Cell; placebo: Cell; none: Cell }>;
  placeboVsNone: number | null;
  invalid: number;
  priceMismatch: number;
}

export function analyze(
  records: SessionRecord[],
  targetUpc: string,
  models: readonly string[],
  basis: "sessions" | "buyers" = "sessions",
): Analysis {
  const byModel = tally(records, targetUpc);
  const strata = models.map((model) => {
    const m = byModel.get(model);
    return {
      model,
      exposed: counts(cellOf(m, "test"), basis),
      placebo: counts(cellOf(m, "placebo"), basis),
    };
  });
  const pooled = { test: empty(), placebo: empty(), none: empty() } as { [A in EvalArm]: Cell };
  for (const m of byModel.values()) {
    for (const arm of ["test", "placebo", "none"] as const) {
      const c = cellOf(m, arm);
      const p = pooled[arm];
      p.sessions += c.sessions;
      p.target += c.target;
      p.buyers += c.buyers;
      p.declines += c.declines;
    }
  }
  const rate = (c: Cell) => {
    const d = basis === "sessions" ? c.sessions : c.buyers;
    return d === 0 ? null : c.target / d;
  };
  const pr = rate(pooled.placebo);
  const nr = rate(pooled.none);
  return {
    lift: computeLift(strata),
    pooled,
    byModel: models.map((model) => {
      const m = byModel.get(model);
      return {
        model,
        test: cellOf(m, "test"),
        placebo: cellOf(m, "placebo"),
        none: cellOf(m, "none"),
      };
    }),
    placeboVsNone: pr === null || nr === null ? null : pr - nr,
    invalid: records.filter((r) => r.outcome.action === "invalid").length,
    priceMismatch: records.filter((r) => r.outcome.action === "buy" && r.outcome.priceOk === false)
      .length,
  };
}

/** The card's derived chain: exposed sales → credited units → commission → refund of the deposit. */
export function derive(
  records: SessionRecord[],
  targetUpc: string,
  models: readonly string[],
  unitPrice: Money,
  exposedSales: number,
  deposit: Money,
) {
  const byModel = tally(records, targetUpc);
  const strata = models.map((model) => {
    const m = byModel.get(model);
    return {
      model,
      exposed: counts(cellOf(m, "test"), "sessions"),
      placebo: counts(cellOf(m, "placebo"), "sessions"),
    };
  });
  const credit = creditBrand({ strata, exposedSales, unitPrice });
  return {
    exposedSales,
    fraction: credit.fraction,
    units: credit.units,
    commission: credit.commission,
    refund: {
      amountMinor: deposit.amountMinor - credit.commission.amountMinor,
      currency: deposit.currency,
    },
  };
}
