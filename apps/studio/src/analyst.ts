/**
 * The Analyst's recommendation, computed from the engine's read API (originally PR #73).
 * One action only: top up a brand's programme deposit. Money never buys rank or verdicts
 * (rule 3), so it is about the category deposit, never "pay creator X", and says so.
 *
 * In AG Studio the Analyst agent gathers these numbers through the built-in Data agent and
 * charts them through the Page and Widget agents; this module is the server's own copy of the
 * rule, so the approval never takes an amount from the browser.
 */
import { buildDashboard, type RawEngine } from "./dashboard";
import { batchLabels } from "./tables";

export const TOP_UP_STEP_MINOR = 50_000;

export interface Citation {
  label: string;
  value: string;
  /** The engine read API path the number comes from. */
  source: string;
}

export interface Facts {
  brandId: string;
  brandName: string;
  category: string;
  currency: string;
  exposedSales: number;
  causedUnits: number;
  /** Lift at the 80% lower bound, as a fraction. Null when there is no data. */
  lowerBound: number | null;
  creditedMinor: number;
  paidMinor: number;
  voidedMinor: number;
  returnedMinor: number;
  availableMinor: number;
  topUpsMinor: number;
  topUpCount: number;
  /** Payout cycles so far: distinct payout days (at least one). */
  cycles: number;
  /** What one cycle credits at this programme's rate. */
  perCycleMinor: number;
}

export interface Recommendation {
  brandId: string;
  category: string;
  /** Unique per top-up, so a second recommendation is a second deposit, never a replay. */
  approvalId: string;
  action: "raise_cap" | "none";
  amountMinor: number | null;
  headline: string;
  rationale: string;
  citations: Citation[];
  guard: string;
}

export const GUARD = "Category deposit only. Money never changes ranking, placement or a verdict.";

export const usd = (minor: number) => {
  const sign = minor < 0 ? "-" : "";
  const a = Math.abs(minor);
  return `${sign}$${Math.floor(a / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(a % 100).padStart(2, "0")}`;
};
const pct = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`;

export function facts(raw: RawEngine, brandId = "winix"): Facts | null {
  const b = buildDashboard(raw).brands.find((x) => x.brandId === brandId);
  if (!b) return null;
  const dep = raw.deposits.find((x) => x.brandId === brandId);
  const days = new Set([...batchLabels(raw).values()].map((l) => l.split(" · ")[1] ?? l));
  const cycles = Math.max(1, days.size);
  return {
    brandId: b.brandId,
    brandName: b.name,
    category: b.category,
    currency: dep?.currency ?? "USD",
    exposedSales: b.exposedSales,
    causedUnits: b.causedUnits,
    lowerBound: b.lowerBound,
    creditedMinor: b.credited,
    paidMinor: b.paid,
    voidedMinor: b.voided,
    returnedMinor: b.deposit.returned,
    availableMinor: b.deposit.available,
    topUpsMinor: b.deposit.topUps,
    topUpCount: dep?.deposits.filter((d) => d.kind === "topup").length ?? 0,
    cycles,
    perCycleMinor: Math.floor(b.credited / cycles),
  };
}

/**
 * Raise the cap when lift is proven (lower bound above zero, units caused) and the deposit
 * left cannot fund another cycle at this programme's rate. Amount: the shortfall, in $500 steps.
 */
export function recommendAmount(f: Facts): number | null {
  const proven = f.lowerBound !== null && f.lowerBound > 0 && f.causedUnits > 0;
  if (!proven) return null;
  const shortfall = f.perCycleMinor - f.availableMinor;
  if (shortfall <= 0) return null;
  return Math.ceil(shortfall / TOP_UP_STEP_MINOR) * TOP_UP_STEP_MINOR;
}

export function citations(f: Facts): Citation[] {
  return [
    {
      label: "Sales the test caused",
      value: `${f.causedUnits} of ${f.exposedSales} exposed`,
      source: "/api/cited/api/lift",
    },
    {
      label: "Lift at the 80% lower bound",
      value: f.lowerBound === null ? "none yet" : pct(f.lowerBound),
      source: "/api/cited/api/lift",
    },
    {
      label: `Credited over ${f.cycles} payout cycle${f.cycles === 1 ? "" : "s"}`,
      value: usd(f.creditedMinor),
      source: "/api/cited/api/credits",
    },
    { label: "Voided by refunds", value: usd(f.voidedMinor), source: "/api/cited/api/credits" },
    { label: "Deposit left", value: usd(f.availableMinor), source: "/api/cited/api/deposits" },
    {
      label: "Unspent deposit returned",
      value: usd(f.returnedMinor),
      source: "/api/cited/api/deposits",
    },
  ];
}

export function recommend(raw: RawEngine, brandId = "winix"): Recommendation | null {
  const f = facts(raw, brandId);
  if (!f) return null;
  const amount = recommendAmount(f);
  const base = {
    brandId: f.brandId,
    category: f.category,
    approvalId: `analyst-${f.topUpCount + 1}`,
    citations: citations(f),
    guard: GUARD,
  };
  if (amount === null) {
    const proven = f.lowerBound !== null && f.lowerBound > 0 && f.causedUnits > 0;
    return {
      ...base,
      action: "none",
      amountMinor: null,
      headline: !proven
        ? `No top-up: ${f.brandName}'s lift is not proven at the 80% lower bound`
        : "No top-up: the deposit covers the next cycle",
      rationale: proven
        ? `${usd(f.availableMinor)} is left against ${usd(f.perCycleMinor)} credited per payout cycle.`
        : "A close verdict pays nothing, so there is nothing to fund.",
    };
  }
  return {
    ...base,
    action: "raise_cap",
    amountMinor: amount,
    headline: `Raise the ${f.category} programme cap for ${f.brandName} by ${usd(amount)}`,
    rationale:
      `${f.brandName}'s test caused ${f.causedUnits} of ${f.exposedSales} exposed sales at the 80% lower bound (${pct(f.lowerBound ?? 0)} lift), so the lift is proven. ` +
      `A payout cycle credits ${usd(f.perCycleMinor)} at this rate, but only ${usd(f.availableMinor)} of the deposit is left. ` +
      `Raise the ${f.category} programme cap by ${usd(amount)}.`,
  };
}
