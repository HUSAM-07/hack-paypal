import type { EvalArm, PriceCondition, StudyId } from "./world";

export type Variant = "forced" | "abstain";

export const MODELS = ["gpt-6-luna", "gemini-3.8-flash", "claude-sonnet-5-5"] as const;
export const SEED = 20261105;

export interface CellSizes {
  test: number;
  placebo: number;
  none: number;
}

export interface Design {
  study: StudyId;
  /** Absent means catalogue prices. */
  price?: PriceCondition;
  variant: Variant;
  /** Sessions per model and arm. */
  perModel: CellSizes;
}

export const DESIGNS: Design[] = [
  { study: "purifier", variant: "forced", perModel: { test: 19, placebo: 18, none: 12 } },
  { study: "purifier", variant: "abstain", perModel: { test: 19, placebo: 18, none: 12 } },
  { study: "narrow", variant: "forced", perModel: { test: 10, placebo: 10, none: 7 } },
];

const PM: CellSizes = { test: 19, placebo: 18, none: 12 };
export const PRICE_SEED = 20261106;
/** Price-matched purifier study: Levoit at parity with Winix, and Levoit $4 cheaper. */
export const PRICE_DESIGNS: Design[] = [
  { study: "purifier", price: "parity", variant: "forced", perModel: PM },
  { study: "purifier", price: "parity", variant: "abstain", perModel: PM },
  { study: "purifier", price: "levoit-cheaper", variant: "forced", perModel: PM },
  { study: "purifier", price: "levoit-cheaper", variant: "abstain", perModel: PM },
];

export const VACUUM_SEED = 20261112;
/**
 * Robot-vacuum study: the same design as the price-matched purifier study, in a second category.
 * Rival (Roomba) priced the same as the target (Roborock), and $4 cheaper.
 */
export const VACUUM_DESIGNS: Design[] = [
  { study: "vacuum", price: "parity", variant: "forced", perModel: PM },
  { study: "vacuum", price: "parity", variant: "abstain", perModel: PM },
  { study: "vacuum", price: "rival-cheaper", variant: "forced", perModel: PM },
  { study: "vacuum", price: "rival-cheaper", variant: "abstain", perModel: PM },
];

export const HEADPHONE_SEED = 20261113;
/**
 * Headphone study: the same design again, in a third category. Rival (Sony) priced the same as the
 * target (Bose), and $4 cheaper. At equal price the rival is listed first (UPC tie-break).
 */
export const HEADPHONE_DESIGNS: Design[] = [
  { study: "headphones", price: "parity", variant: "forced", perModel: PM },
  { study: "headphones", price: "parity", variant: "abstain", perModel: PM },
  { study: "headphones", price: "rival-cheaper", variant: "forced", perModel: PM },
  { study: "headphones", price: "rival-cheaper", variant: "abstain", perModel: PM },
];

export interface Session {
  id: string;
  price?: PriceCondition;
  study: StudyId;
  variant: Variant;
  model: string;
  arm: EvalArm;
  intent: number;
}

/** mulberry32: small seeded PRNG so the plan is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function plan(designs: Design[] = DESIGNS, seed = SEED): Session[] {
  const rand = rng(seed);
  const out: Session[] = [];
  for (const d of designs) {
    for (const model of MODELS) {
      for (const arm of ["test", "placebo", "none"] as const) {
        const n = d.perModel[arm];
        // Intents rotate within a cell from a seeded start, so each arm sees all four near-equally.
        const start = Math.floor(rand() * 4);
        for (let k = 0; k < n; k++) {
          out.push({
            id: `${d.study}-${d.price ? `${d.price}-` : ""}${d.variant}-${model}-${arm}-${k}`,
            ...(d.price ? { price: d.price } : {}),
            study: d.study,
            variant: d.variant,
            model,
            arm,
            intent: (start + k) % 4,
          });
        }
      }
    }
  }
  // Seeded shuffle so arms interleave in time.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as Session, out[i] as Session];
  }
  return out;
}
