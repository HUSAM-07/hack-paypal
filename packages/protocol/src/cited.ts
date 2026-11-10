import { z } from "zod";
import { Money } from "./money";

// CITED contract: the shared shapes for the catalogue, agents, shops, attribution
// engine and dashboards. Keep changes additive so parallel work doesn't break.

const Id = z.string().min(1).max(64);
const Timestamp = z.iso.datetime();
/** UPC-A: 12 digits. Sales join to creator tests on this. */
export const Upc = z.string().regex(/^\d{12}$/);

/** 8% commission on caused sales, in basis points so the maths stays integer. */
export const COMMISSION_BPS = 800;
/** Credits are held this long before payout, so refunds and disputes can void them. */
export const HOLD_DAYS = 30;
/** PayPal caps `purchase_units[].custom_id` at 127 characters. The passport must fit. */
export const CUSTOM_ID_MAX = 127;

// ── Content an agent can be shown ──

export const Arm = z.enum(["test", "placebo", "none"]);
export type Arm = z.infer<typeof Arm>;

export const Sku = z.object({ upc: Upc, brand: z.string(), name: z.string() });
export type Sku = z.infer<typeof Sku>;

/**
 * A creator's measured test, delivered as a structured object. `kind: "placebo"` is other
 * content from the same creator, so the placebo arm strips out the creator's reputation.
 */
export const VerifiedTest = z.object({
  id: Id,
  kind: z.enum(["test", "placebo"]),
  creatorId: Id,
  category: z.string(),
  skus: z.array(Sku),
  /** UPC the verdict recommends; absent for placebos and close calls. */
  verdictUpc: Upc.optional(),
  summary: z.string(),
  /** FTC endorsement disclosure (16 CFR 255), always shown to agents with the test. */
  disclosure: z.string().min(1),
});
export type VerifiedTest = z.infer<typeof VerifiedTest>;

// ── Holdout schedule ──

export const HoldoutSchedule = z.object({
  calibrationDays: z.number().int().positive(),
  /** Share of sessions shown the test while a new test calibrates. */
  calibrationTestShare: z.number().gt(0).lt(1),
  /** Share of sessions held out (placebo or none) after calibration, permanently. */
  steadyHoldoutShare: z.number().gt(0).lt(1),
  /** How the held-out share splits between placebo and none. */
  placeboShareOfHoldout: z.number().min(0).max(1),
});
export type HoldoutSchedule = z.infer<typeof HoldoutSchedule>;

export const DEFAULT_SCHEDULE: HoldoutSchedule = {
  calibrationDays: 7,
  calibrationTestShare: 0.5,
  steadyHoldoutShare: 0.05,
  placeboShareOfHoldout: 0.5,
};

/** Arm probabilities on a given day of a test's life (day 0 = published). */
export function armProbabilities(day: number, s: HoldoutSchedule): Record<Arm, number> {
  const held = day < s.calibrationDays ? 1 - s.calibrationTestShare : s.steadyHoldoutShare;
  return {
    test: 1 - held,
    placebo: held * s.placeboShareOfHoldout,
    none: held * (1 - s.placeboShareOfHoldout),
  };
}

// ── Agent Affiliate Passport: replaces the affiliate cookie ──

/** Short ids keep the encoded passport inside `custom_id`. */
const ShortId = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/);

export const PassportBody = z.object({
  v: z.literal(1),
  sessionId: ShortId,
  arm: Arm,
  creatorsSeen: z.array(ShortId).max(4),
  storesViewed: z.array(ShortId).max(4),
});
export type PassportBody = z.infer<typeof PassportBody>;

/**
 * `v1|sess|arm|creatorA,creatorB|storeA,storeB`. The signature is appended by the issuer
 * (`body.sig`) and checked by the attribution engine; this module only handles the body.
 */
export function encodePassportBody(p: PassportBody): string {
  const body = PassportBody.parse(p);
  return [
    `v${body.v}`,
    body.sessionId,
    body.arm,
    body.creatorsSeen.join(","),
    body.storesViewed.join(","),
  ].join("|");
}

export function decodePassportBody(s: string): PassportBody {
  const [v, sessionId, arm, creators = "", stores = ""] = s.split("|");
  if (v !== "v1") throw new Error(`unknown passport version: ${v}`);
  return PassportBody.parse({
    v: 1,
    sessionId,
    arm,
    creatorsSeen: creators ? creators.split(",") : [],
    storesViewed: stores ? stores.split(",") : [],
  });
}

/**
 * Sessions opened through the public MCP endpoint (`/mcp`) carry this session-id prefix, set by
 * the catalogue when it signs the passport. The engine records their sales as source `mcp` and
 * keeps them out of the study, the ledger and the console's numbers.
 */
export const PUBLIC_MCP_SESSION_PREFIX = "mcp_";
export type SaleSource = "agent" | "mcp";
export function saleSource(sessionId: string | null | undefined): SaleSource {
  return sessionId?.startsWith(PUBLIC_MCP_SESSION_PREFIX) ? "mcp" : "agent";
}

// ── Sales, credits and money movements ──

/** A captured PayPal sale joined to the session that produced it. */
export const AttributedSale = z.object({
  captureId: Id,
  orderId: Id,
  shopId: ShortId,
  upc: Upc,
  amount: Money,
  sessionId: ShortId,
  arm: Arm,
  creatorsSeen: z.array(ShortId),
  /** Agent model family, for model-stratified lift. */
  model: z.string(),
  capturedAt: Timestamp,
});
export type AttributedSale = z.infer<typeof AttributedSale>;

export const CreditState = z.enum(["pending", "voided", "paid"]);
export const VoidReason = z.enum(["refund", "partial_refund", "dispute"]);

/** One creator's share of one caused sale, paid by the brand whose SKU lifted. */
export const Credit = z.object({
  id: Id,
  captureId: Id,
  creatorId: ShortId,
  brandId: ShortId,
  upc: Upc,
  amount: Money,
  state: CreditState,
  voidReason: VoidReason.optional(),
  holdUntil: Timestamp,
  payoutBatchId: Id.optional(),
});
export type Credit = z.infer<typeof Credit>;

/** A brand's funding for a category programme. Funding buys measurement, never rank. */
export const ProgrammeDeposit = z.object({
  id: Id,
  brandId: ShortId,
  category: z.string(),
  captureId: Id,
  deposited: Money,
  spent: Money,
  returned: Money,
});
export type ProgrammeDeposit = z.infer<typeof ProgrammeDeposit>;

/** Commission on a sale amount, rounded down to the minor unit so we never overpay. */
export function commissionOn(amount: Money): Money {
  return {
    amountMinor: Math.floor((amount.amountMinor * COMMISSION_BPS) / 10_000),
    currency: amount.currency,
  };
}
