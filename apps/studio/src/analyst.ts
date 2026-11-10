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
  /** Point lift, shown the test vs the same creator's placebo, as a fraction. */
  lift: number | null;
  /** Purchases of this brand per arm. */
  test: { sessions: number; purchases: number };
  placebo: { sessions: number; purchases: number };
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
  /** Two plain sentences the Analyst can say as they are: every number in them is cited. */
  summary: string;
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
/** usd() without ".00" on whole dollars, for spoken sentences. */
const say = (minor: number) => usd(minor).replace(/\.00$/, "");
const pct = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`;
/** A lift in percentage points, signed and whole: 0.944 -> "+94 points". */
export const points = (x: number) => {
  const n = Math.round(x * 100);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)} points`;
};
const bought = (a: { sessions: number; purchases: number }) => `${a.purchases} of ${a.sessions}`;

export function facts(raw: RawEngine, brandId = "winix"): Facts | null {
  const b = buildDashboard(raw).brands.find((x) => x.brandId === brandId);
  if (!b) return null;
  const dep = raw.deposits.find((x) => x.brandId === brandId);
  const days = new Set([...batchLabels(raw).values()].map((l) => l.split(" · ")[1] ?? l));
  const cycles = Math.max(1, days.size);
  const l = raw.lift.find((x) => x.brandId === brandId);
  const arm = (a: "test" | "placebo") => ({
    sessions: l?.arms[a]?.sessions ?? 0,
    purchases: l?.arms[a]?.purchases ?? 0,
  });
  return {
    brandId: b.brandId,
    brandName: b.name,
    category: b.category,
    currency: dep?.currency ?? "USD",
    exposedSales: b.exposedSales,
    causedUnits: b.causedUnits,
    lowerBound: b.lowerBound,
    lift: l?.lift ?? null,
    test: arm("test"),
    placebo: arm("placebo"),
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
      label: "Lift, shown the test vs the same creator's placebo",
      value:
        f.lift === null
          ? "none yet"
          : `${points(f.lift)} (bought ${bought(f.test)} vs ${bought(f.placebo)})`,
      source: "/api/cited/api/lift",
    },
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
  const proven = f.lowerBound !== null && f.lowerBound > 0 && f.causedUnits > 0;
  const shown = `Shown the test, agents bought ${f.brandName} ${bought(f.test)} times against ${bought(f.placebo)} on the same creator's placebo`;
  if (amount === null) {
    return {
      ...base,
      action: "none",
      amountMinor: null,
      headline: !proven
        ? `No top-up: ${f.brandName}'s lift is not proven at the 80% lower bound`
        : "No top-up: the deposit covers the next cycle",
      rationale: proven
        ? `${usd(f.availableMinor)} is left against ${usd(f.perCycleMinor)} credited per payout cycle.`
        : "A test that does not lift a brand's sales pays nothing, so there is nothing to fund.",
      summary: !proven
        ? `${shown}: ${f.lift === null ? "no lift yet" : points(f.lift)}, so the test caused no ${f.brandName} sales and ${f.brandName} pays nothing.` +
          (f.returnedMinor > 0 ? ` Its ${say(f.returnedMinor)} deposit came back unspent.` : "")
        : `${shown}: ${points(f.lift ?? 0)}. Keep the ${f.category} cap: ${say(f.availableMinor)} is left, and a payout cycle credits ${say(f.perCycleMinor)}.`,
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
    summary:
      `${shown}: ${points(f.lift ?? 0)}, ${points(f.lowerBound ?? 0).replace(" points", "")} at the 80% lower bound. ` +
      `Raise the ${f.category} cap by ${say(amount)}: ${say(f.availableMinor)} is left and a payout cycle credits ${say(f.perCycleMinor)}.`,
  };
}
