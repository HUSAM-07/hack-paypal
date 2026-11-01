import { z } from "zod";
import { Money } from "./money";

const Id = z.string().min(1).max(128);
const Timestamp = z.iso.datetime();

// ── Mandates: a member's pre-signed, revocable permission for the agent to spend ──

export const MandateStatus = z.enum(["active", "revoked", "exhausted", "expired"]);

export const Mandate = z.object({
  id: Id,
  userId: Id,
  /** A mandate scoped to a pact can only fund that pact; omit for a global mandate. */
  pactId: Id.optional(),
  maxPerCharge: Money,
  maxTotal: Money,
  period: z.enum(["none", "day", "week", "month"]).default("none"),
  categories: z.array(z.string()).optional(),
  merchantAllow: z.array(z.string()).optional(),
  merchantDeny: z.array(z.string()).optional(),
  validFrom: Timestamp,
  validUntil: Timestamp,
  maxCharges: z.number().int().positive().optional(),
  /** Charges at or above this need a fresh passkey assertion even inside the mandate. */
  stepUpAbove: Money.optional(),
  /** Opaque reference to the PayPal vault token; never the token itself on the client. */
  fundingRef: Id.optional(),
  status: MandateStatus,
  createdAt: Timestamp,
});
export type Mandate = z.infer<typeof Mandate>;

export const SpendIntent = z.object({
  id: Id,
  userId: Id,
  pactId: Id.optional(),
  amount: Money,
  merchant: z.string(),
  category: z.string().optional(),
  description: z.string().max(500),
  initiatedBy: z.enum(["user", "agent", "schedule"]),
  at: Timestamp,
});
export type SpendIntent = z.infer<typeof SpendIntent>;

export const DenyReason = z.enum([
  "no_mandate",
  "mandate_revoked",
  "mandate_expired",
  "mandate_not_started",
  "over_per_charge",
  "over_total",
  "over_period",
  "over_charge_count",
  "currency_mismatch",
  "merchant_denied",
  "merchant_not_allowed",
  "category_not_allowed",
  "wrong_pact",
]);
export type DenyReason = z.infer<typeof DenyReason>;

export const PolicyDecision = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("allow"), mandateId: Id }),
  z.object({
    outcome: z.literal("needs_approval"),
    mandateId: Id.optional(),
    reasons: z.array(z.union([DenyReason, z.literal("step_up_required")])),
  }),
  z.object({ outcome: z.literal("deny"), reasons: z.array(DenyReason).min(1) }),
]);
export type PolicyDecision = z.infer<typeof PolicyDecision>;

// ── Pacts: a shared, conditional money agreement executed by the agent ──

export const PactState = z.enum([
  "draft",
  "collecting",
  "armed",
  "triggered",
  "settling",
  "done",
  "cancelled",
  "failed",
]);
export type PactState = z.infer<typeof PactState>;

export const PactTrigger = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("price"),
    productRef: Id,
    maxPrice: Money,
    deadline: Timestamp,
  }),
  z.object({
    kind: z.literal("schedule"),
    everyDays: z.number().int().min(1).max(365),
    startAt: Timestamp,
    endAt: Timestamp.optional(),
    maxRuns: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("quorum"),
    confirmationsNeeded: z.number().int().positive(),
    expiresAt: Timestamp,
  }),
  z.object({ kind: z.literal("manual") }),
]);
export type PactTrigger = z.infer<typeof PactTrigger>;

export const PactAction = z.discriminatedUnion("kind", [
  /** Buy a catalog product; members' shares fund it. */
  z.object({ kind: z.literal("purchase"), productRef: Id, quantity: z.number().int().min(1) }),
  /** Pay a person (P2P) from members' shares. */
  z.object({
    kind: z.literal("payout"),
    payeeUserId: Id.optional(),
    payeeEmail: z.email().optional(),
    amount: Money,
  }),
  /** Collect money from members to the organizer (e.g. settle a dinner). */
  z.object({ kind: z.literal("collect"), total: Money }),
]);
export type PactAction = z.infer<typeof PactAction>;

export const PactSplit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("equal") }),
  z.object({ kind: z.literal("weights"), weights: z.record(Id, z.number().positive()) }),
  z.object({ kind: z.literal("fixed"), amounts: z.record(Id, Money) }),
]);

export const MemberStatus = z.enum([
  "invited",
  "committed",
  "declined",
  "revoked",
  "charged",
  "failed",
]);

export const PactMember = z.object({
  userId: Id,
  displayName: z.string().max(80),
  role: z.enum(["organizer", "member"]),
  /** Most a member agreed to pay toward this pact; the split can never charge more. */
  cap: Money,
  status: MemberStatus,
  mandateId: Id.optional(),
});
export type PactMember = z.infer<typeof PactMember>;

export const Pact = z.object({
  id: Id,
  threadId: Id,
  title: z.string().max(120),
  /** The user's original sentence, kept verbatim for audit. */
  instruction: z.string().max(1000),
  organizerId: Id,
  members: z.array(PactMember).min(1).max(20),
  trigger: PactTrigger,
  action: PactAction,
  split: PactSplit,
  state: PactState,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Pact = z.infer<typeof Pact>;
