/**
 * Every number on /proof, read at build time from the committed eval summaries.
 * Nothing here is typed in by hand except the card's scripted demo amounts, which say so.
 */
import {
  attributableFraction,
  computeLift,
  creditedUnits,
  type LiftResult,
} from "@pact/attribution";
import { COMMISSION_BPS } from "@pact/protocol";
import catalogueSummary from "../../../../packages/evals/results/cited/summary.json";
import priceSummary from "../../../../packages/evals/results/cited-price-matched/summary.json";

export interface Cell {
  sessions: number;
  target: number;
  buyers: number;
  declines: number;
}
export interface StudyResult {
  sessions: number;
  lift: LiftResult;
  pooled: { test: Cell; placebo: Cell; none: Cell };
  byModel: { model: string; test: Cell; placebo: Cell; none: Cell }[];
  placeboVsNone: number | null;
  invalid: number;
}
interface BuyersOnly {
  lift: LiftResult;
  pooled: { test: Cell; placebo: Cell; none: Cell };
}

const P = priceSummary as unknown as Record<string, StudyResult & BuyersOnly>;
const C = catalogueSummary as unknown as Record<string, StudyResult & BuyersOnly>;

function need<T>(v: T | undefined, key: string): T {
  if (!v) throw new Error(`summary.json has no ${key}`);
  return v;
}

export const REPO = "https://github.com/HUSAM-07/hack-paypal";
export const blob = (path: string) => `${REPO}/blob/main/${path}`;
export const commit = (sha: string) => `${REPO}/commit/${sha}`;

export const PATHS = {
  priceSummary: "packages/evals/results/cited-price-matched/summary.md",
  priceSummaryJson: "packages/evals/results/cited-price-matched/summary.json",
  priceResults: "packages/evals/results/cited-price-matched/results.jsonl",
  priceReg: "packages/evals/scenarios/cited/PREREGISTRATION-PRICE-MATCHED.md",
  catalogueSummary: "packages/evals/results/cited/summary.md",
  catalogueSummaryJson: "packages/evals/results/cited/summary.json",
  catalogueResults: "packages/evals/results/cited/results.jsonl",
  catalogueReg: "packages/evals/scenarios/cited/PREREGISTRATION.md",
  card: "cited/spec/CITED-card.md",
  lift: "packages/attribution/src/lift.ts",
  ledger: "packages/attribution/src/ledger.ts",
  runner: "packages/evals/src/cited/run.ts",
  world: "packages/evals/src/cited/world.ts",
  reference: "cited/eval-reference/pooled-all-runs.txt",
} as const;

export const studies = {
  parityForced: need(P["purifier-parity-forced"], "purifier-parity-forced"),
  parityAbstain: need(P["purifier-parity-abstain"], "purifier-parity-abstain"),
  parityAbstainBuyers: need(
    P["purifier-parity-abstain-buyers-only"],
    "purifier-parity-abstain-buyers-only",
  ),
  cheaperForced: need(P["purifier-levoit-cheaper-forced"], "purifier-levoit-cheaper-forced"),
  cheaperAbstain: need(P["purifier-levoit-cheaper-abstain"], "purifier-levoit-cheaper-abstain"),
  cheaperAbstainBuyers: need(
    P["purifier-levoit-cheaper-abstain-buyers-only"],
    "purifier-levoit-cheaper-abstain-buyers-only",
  ),
  catalogueForced: need(C["purifier-forced"], "purifier-forced"),
  catalogueAbstain: need(C["purifier-abstain"], "purifier-abstain"),
  catalogueAbstainBuyers: need(C["purifier-abstain-buyers-only"], "purifier-abstain-buyers-only"),
  narrowForced: need(C["narrow-forced"], "narrow-forced"),
};

export const MODEL_NAMES: Record<string, string> = {
  "gpt-6-luna": "GPT",
  "gemini-3.8-flash": "Gemini",
  "claude-sonnet-5-5": "Sonnet",
};

/**
 * One model's own lift and 80% lower bound: the committed counts through the same
 * computeLift the engine uses, with that model as the only stratum.
 */
export function modelLift(s: StudyResult, model: string): LiftResult {
  const m = need(
    s.byModel.find((x) => x.model === model),
    model,
  );
  return computeLift([
    {
      model,
      exposed: { sessions: m.test.sessions, purchases: m.test.target },
      placebo: { sessions: m.placebo.sessions, purchases: m.placebo.target },
    },
  ]);
}

/** The demo's numbers, from the card: one Winix sale per exposed agent at Lumen's $95.99. */
export const DEMO = {
  unitPriceMinor: 9599,
  deposit: 100_000,
  /** Scripted in the demo (cited/spec/CITED-card.md): one buyer returns one Winix. */
  voidMinor: 768,
};

/**
 * The card's derived chain, computed from the headline study. The ledger rounds the
 * batch's 8% commission once, to the nearest cent (createCredits in ledger.ts).
 */
export function moneyChain(s: StudyResult = studies.parityForced) {
  const exposedSales = s.pooled.test.target;
  const fraction = attributableFraction(s.lift.lowerBound, s.lift.exposedRate);
  const units = creditedUnits(exposedSales, fraction);
  const commission = Math.round((units * DEMO.unitPriceMinor * COMMISSION_BPS) / 10_000);
  const paid = commission - DEMO.voidMinor;
  return {
    exposedSales,
    fraction,
    units,
    commission,
    paid,
    returned: DEMO.deposit - paid,
    commissionBps: COMMISSION_BPS,
  };
}

export type Verdict = "met" | "not met" | "reported";

/** Each pre-registered hypothesis, checked against its threshold in the committed numbers. */
export function hypotheses() {
  const s = studies;
  const allModelsPositive = (r: StudyResult) => r.lift.perModel.every((m) => m.lift > 0);
  const pVsN = (r: StudyResult) => Math.abs(r.placeboVsNone ?? Number.POSITIVE_INFINITY);
  const v = (ok: boolean): Verdict => (ok ? "met" : "not met");
  return {
    priceMatched: [
      {
        id: "P1",
        text: "Parity, forced: pooled lift ≥ +15pp, 80% lower bound > 0, test beats placebo in each model.",
        verdict: v(
          s.parityForced.lift.lift >= 0.15 &&
            s.parityForced.lift.lowerBound > 0 &&
            allModelsPositive(s.parityForced),
        ),
      },
      {
        id: "P2",
        text: "Levoit $4 cheaper, forced: 80% lower bound > 0.",
        verdict: v(s.cheaperForced.lift.lowerBound > 0),
      },
      {
        id: "P3",
        text: "Placebo is neutral: |placebo − nothing| ≤ 20pp in each price condition.",
        verdict: v(pVsN(s.parityForced) <= 0.2 && pVsN(s.cheaperForced) <= 0.2),
      },
      {
        id: "P4",
        text: "Abstain allowed: a lift is claimed only if the buyers-only 80% lower bound > 0.",
        verdict: v(
          s.parityAbstainBuyers.lift.lowerBound > 0 && s.cheaperAbstainBuyers.lift.lowerBound > 0,
        ),
      },
    ],
    catalogue: [
      {
        id: "H1",
        text: "Winix cheaper, forced: pooled lift ≥ +15pp, 80% lower bound > 0, test beats placebo in each model.",
        verdict: v(
          s.catalogueForced.lift.lift >= 0.15 &&
            s.catalogueForced.lift.lowerBound > 0 &&
            allModelsPositive(s.catalogueForced),
        ),
      },
      {
        id: "H2",
        text: "Close verdict: the 80% lower bound is ≤ 0, so nothing is credited.",
        verdict: v(s.narrowForced.lift.lowerBound <= 0),
      },
      {
        id: "H3",
        text: "Placebo is neutral: |placebo − nothing| ≤ 20pp in the purifier study.",
        verdict: v(pVsN(s.catalogueForced) <= 0.2),
      },
      {
        id: "H4",
        text: "Abstain allowed: no pass threshold; reported as measured.",
        verdict: "reported" as Verdict,
      },
    ],
  };
}

export function pp(x: number, d = 1): string {
  const v = Math.abs(x * 100).toFixed(d);
  if (Number(v) === 0) return `${v}pp`;
  return `${x > 0 ? "+" : "−"}${v}pp`;
}
export const pct = (n: number, d: number) => `${Math.round((n / d) * 100)}%`;
export const usd = (minor: number) =>
  `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
