import { COMMISSION_BPS, commissionOn, type Money } from "@pact/protocol";

/** One-sided 80% normal quantile: the conservative bound the card pays on. */
export const Z_80_ONE_SIDED = 0.8416212335729143;

/** Sessions shown an arm and how many of them bought the target brand's SKU. */
export interface ArmCounts {
  sessions: number;
  purchases: number;
}

/** Test-vs-placebo counts for one agent model. */
export interface ModelCounts {
  model: string;
  exposed: ArmCounts;
  placebo: ArmCounts;
}

export interface ModelLift {
  model: string;
  exposedRate: number;
  placeboRate: number;
  lift: number;
  /** Stratum weight; 0 when a stratum has no sessions in an arm. */
  weight: number;
}

export interface LiftResult {
  exposedRate: number;
  placeboRate: number;
  /** Pooled exposed − placebo purchase rate, as a fraction (0.44 = +44pp). */
  lift: number;
  stdError: number;
  /** lift − z·SE, one-sided 80%. May be negative: that means "no proven lift". */
  lowerBound: number;
  perModel: ModelLift[];
}

function checkCounts(c: ArmCounts, label: string): void {
  if (!Number.isInteger(c.sessions) || !Number.isInteger(c.purchases) || c.sessions < 0) {
    throw new Error(`${label}: counts must be non-negative integers`);
  }
  if (c.purchases < 0 || c.purchases > c.sessions) {
    throw new Error(`${label}: purchases must be within 0..sessions`);
  }
}

const rate = (c: ArmCounts) => (c.sessions === 0 ? 0 : c.purchases / c.sessions);

/**
 * Model-stratified lift on the difference of proportions (normal approximation).
 *
 * Each model m gets d_m = pE − pP. Strata are pooled with weight
 * w_m = nE·nP / (nE + nP), the minimum-variance weight when the models share a
 * variance, and unlike inverse-variance weights it stays defined when a rate is
 * 0 or 1. Pooled lift = Σ w·d / Σ w; its variance = Σ w²·v / (Σ w)².
 *
 * v_m uses add-one-success/one-failure rates (p̃ = (x+1)/(n+2)) so a stratum with
 * a 0% or 100% rate doesn't claim zero variance. Only the variance is adjusted;
 * the reported lift uses the raw rates. Small samples therefore get a wider
 * margin, which is the conservative direction.
 */
export function computeLift(strata: readonly ModelCounts[], z = Z_80_ONE_SIDED): LiftResult {
  const usable: Array<ModelLift & { variance: number; e: ArmCounts; p: ArmCounts }> = [];
  const perModel: ModelLift[] = [];

  for (const s of strata) {
    checkCounts(s.exposed, `${s.model} exposed`);
    checkCounts(s.placebo, `${s.model} placebo`);
    const nE = s.exposed.sessions;
    const nP = s.placebo.sessions;
    const exposedRate = rate(s.exposed);
    const placeboRate = rate(s.placebo);
    const base = { model: s.model, exposedRate, placeboRate, lift: exposedRate - placeboRate };
    if (nE === 0 || nP === 0) {
      perModel.push({ ...base, weight: 0 });
      continue;
    }
    const pe = (s.exposed.purchases + 1) / (nE + 2);
    const pp = (s.placebo.purchases + 1) / (nP + 2);
    const entry = {
      ...base,
      weight: (nE * nP) / (nE + nP),
      variance: (pe * (1 - pe)) / nE + (pp * (1 - pp)) / nP,
      e: s.exposed,
      p: s.placebo,
    };
    usable.push(entry);
    perModel.push({ ...base, weight: entry.weight });
  }

  const totalWeight = usable.reduce((a, u) => a + u.weight, 0);
  if (totalWeight === 0) {
    return {
      exposedRate: 0,
      placeboRate: 0,
      lift: 0,
      stdError: Number.POSITIVE_INFINITY,
      lowerBound: Number.NEGATIVE_INFINITY,
      perModel,
    };
  }

  // Pooled rates use the same weights, so exposedRate − placeboRate === lift.
  const exposedRate = usable.reduce((a, u) => a + u.weight * u.exposedRate, 0) / totalWeight;
  const placeboRate = usable.reduce((a, u) => a + u.weight * u.placeboRate, 0) / totalWeight;
  const lift = exposedRate - placeboRate;
  const variance = usable.reduce((a, u) => a + u.weight ** 2 * u.variance, 0) / totalWeight ** 2;
  const stdError = Math.sqrt(variance);
  return { exposedRate, placeboRate, lift, stdError, lowerBound: lift - z * stdError, perModel };
}

/**
 * Attributable fraction (exposed − placebo) / exposed, evaluated at the lower
 * bound: the share of exposed purchases the test caused, at the credit we can
 * defend. 0 when there is no positive lower bound; capped at 1.
 */
export function attributableFraction(lowerBound: number, exposedRate: number): number {
  if (!(lowerBound > 0) || !(exposedRate > 0)) return 0;
  return Math.min(1, lowerBound / exposedRate);
}

/** Whole units only; the epsilon absorbs float noise like 200 × 0.51 = 101.99999…. */
export function creditedUnits(exposedSales: number, fraction: number): number {
  if (!Number.isInteger(exposedSales) || exposedSales < 0) {
    throw new Error("exposedSales must be a non-negative integer");
  }
  return Math.floor(exposedSales * fraction + 1e-9);
}

export interface BrandCreditInput {
  /** Counts for this brand's own SKU only. A brand never pays on another SKU's lift. */
  strata: readonly ModelCounts[];
  /** Captured sales of this SKU made by sessions in the exposed (test) arm. */
  exposedSales: number;
  unitPrice: Money;
  z?: number;
}

export interface BrandCredit extends LiftResult {
  fraction: number;
  units: number;
  /** Commission owed on the credited units, rounded down by `commissionOn`. */
  commission: Money;
}

/** Credit one brand's SKU: lower-bound lift → fraction → whole units → 8% commission. */
export function creditBrand(input: BrandCreditInput): BrandCredit {
  const lift = computeLift(input.strata, input.z);
  const fraction = attributableFraction(lift.lowerBound, lift.exposedRate);
  const units = creditedUnits(input.exposedSales, fraction);
  const commission = commissionOn({
    amountMinor: units * input.unitPrice.amountMinor,
    currency: input.unitPrice.currency,
  });
  return { ...lift, fraction, units, commission };
}

export { COMMISSION_BPS };
