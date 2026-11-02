/** Pure pact/mandate rules for the money endpoints. No I/O; unit-tested directly. */
import { splitEqual, splitWeighted } from "@pact/policy";
import type { Mandate, Money, Pact, PactTrigger } from "@pact/protocol";
import type { Product } from "../agent/products";

/** What a pact ref resolves to; the web's `PactData` schema reads exactly this. */
export interface PactRefData {
  pact: Pact;
  total: Money;
  shares: { userId: string; share: Money }[] | null;
  /** Price triggers: what PriceWatch renders. */
  watch?: { current: Money; history: { at: string; price: Money }[]; checkedAt: string };
  /** Purchase pacts: the product as its ref resolved when the pact was drafted. */
  product?: Product;
  /** Schedule triggers: upcoming run times (ISO), for ScheduleCard. */
  nextRuns?: string[];
}

const DAY_MS = 86_400_000;
const DEFAULT_MANDATE_DAYS = 90;
/** States in which a member may still commit funding or pay a share. */
const OPEN_STATES: ReadonlySet<Pact["state"]> = new Set(["draft", "collecting", "armed"]);

/** Shares under the pact's split rule and each payer's cap; null when caps can't cover it. */
export function splitShares(
  pact: Pact,
  total: Money,
  payers: readonly Pact["members"][number][] = pact.members,
): PactRefData["shares"] {
  const split = pact.split;
  let parts: Map<string, number> | null;
  if (split.kind === "weights") {
    parts = splitWeighted(
      total.amountMinor,
      payers.map((m) => ({
        userId: m.userId,
        weight: split.weights[m.userId] ?? 0,
        capMinor: m.cap.amountMinor,
      })),
    );
  } else if (split.kind === "fixed") {
    const amounts = payers.map(
      (m) => [m.userId, split.amounts[m.userId]?.amountMinor ?? 0] as const,
    );
    const fits = payers.every(
      (m) => (split.amounts[m.userId]?.amountMinor ?? 0) <= m.cap.amountMinor,
    );
    const sum = amounts.reduce((s, [, a]) => s + a, 0);
    parts = fits && sum === total.amountMinor ? new Map(amounts) : null;
  } else {
    parts = splitEqual(
      total.amountMinor,
      payers.map((m) => ({ userId: m.userId, capMinor: m.cap.amountMinor })),
    );
  }
  if (!parts) return null;
  return [...parts].map(([userId, amountMinor]) => ({
    userId,
    share: { amountMinor, currency: total.currency },
  }));
}

/** The next `count` run times of a schedule at or after `now`, within maxRuns/endAt. */
export function nextRuns(
  trigger: Extract<PactTrigger, { kind: "schedule" }>,
  now: Date,
  count = 5,
): string[] {
  const start = Date.parse(trigger.startAt);
  const step = trigger.everyDays * DAY_MS;
  const end = trigger.endAt ? Date.parse(trigger.endAt) : Number.POSITIVE_INFINITY;
  const first = Math.max(0, Math.ceil((now.getTime() - start) / step));
  const out: string[] = [];
  for (let i = first; out.length < count; i++) {
    if (trigger.maxRuns !== undefined && i >= trigger.maxRuns) break;
    const at = start + i * step;
    if (at > end) break;
    out.push(new Date(at).toISOString());
  }
  return out;
}

export function shareOf(data: PactRefData, userId: string): Money | undefined {
  return data.shares?.find((s) => s.userId === userId)?.share;
}

export type CapProblem =
  | "pact_closed"
  | "not_a_member"
  | "no_share"
  | "currency_mismatch"
  | "cap_below_share"
  | "cap_above_total";

/**
 * A member's cap must cover their current share (otherwise the split can't be funded)
 * and never exceed the pact total (a mandate wider than the pact is pointless risk).
 * Checked when the setup token is minted and again when the mandate is issued, since
 * the split can move in between.
 */
export function capProblem(data: PactRefData, userId: string, cap: Money): CapProblem | null {
  if (!OPEN_STATES.has(data.pact.state)) return "pact_closed";
  if (!data.pact.members.some((m) => m.userId === userId)) return "not_a_member";
  const share = shareOf(data, userId);
  if (!share) return "no_share";
  if (cap.currency !== data.total.currency) return "currency_mismatch";
  if (cap.amountMinor < share.amountMinor) return "cap_below_share";
  if (cap.amountMinor > data.total.amountMinor) return "cap_above_total";
  return null;
}

export function pactOpen(data: PactRefData): boolean {
  return OPEN_STATES.has(data.pact.state);
}

/**
 * Limits for a pact-scoped mandate (UserDO attaches `fundingRef`). One-shot pacts allow a single charge up to the cap.
 * Schedules allow one charge per run: the rolling period total is the cap times the
 * number of runs that fit in it.
 */
export function mandateFor(input: {
  id: string;
  userId: string;
  pact: Pact;
  cap: Money;
  now: Date;
}): Mandate {
  const { pact, cap, now } = input;
  const t = pact.trigger;
  let validUntil = new Date(now.getTime() + DEFAULT_MANDATE_DAYS * DAY_MS);
  let period: Mandate["period"] = "none";
  let maxTotal = cap;
  let maxCharges: number | undefined = 1;
  if (t.kind === "price") validUntil = new Date(Date.parse(t.deadline) + DAY_MS);
  if (t.kind === "quorum") validUntil = new Date(Date.parse(t.expiresAt) + DAY_MS);
  if (t.kind === "schedule") {
    if (t.endAt) validUntil = new Date(Date.parse(t.endAt) + DAY_MS);
    if (t.maxRuns) {
      maxTotal = { ...cap, amountMinor: cap.amountMinor * t.maxRuns };
      maxCharges = t.maxRuns;
    } else {
      period = t.everyDays <= 1 ? "day" : t.everyDays <= 7 ? "week" : "month";
      const periodDays = { day: 1, week: 7, month: 30 }[period];
      maxTotal = { ...cap, amountMinor: cap.amountMinor * Math.ceil(periodDays / t.everyDays) };
      maxCharges = undefined;
    }
  }
  return {
    id: input.id,
    userId: input.userId,
    pactId: pact.id,
    maxPerCharge: cap,
    maxTotal,
    period,
    validFrom: now.toISOString(),
    validUntil: validUntil.toISOString(),
    ...(maxCharges ? { maxCharges } : {}),
    status: "active",
    createdAt: now.toISOString(),
  };
}

/**
 * Marks a member committed with their cap and mandate, re-splits the total under the
 * new caps, and advances draft → collecting → armed (everyone committed).
 * Returns null when the new caps can no longer cover the total.
 */
export function commitMember(
  data: PactRefData,
  userId: string,
  commit: { cap: Money; mandateId: string },
  now: Date,
): PactRefData | null {
  const members = data.pact.members.map((m) =>
    m.userId === userId
      ? { ...m, cap: commit.cap, mandateId: commit.mandateId, status: "committed" as const }
      : m,
  );
  const pact = { ...data.pact, members };
  const payers = members.filter((m) => m.status !== "declined" && m.status !== "revoked");
  const shares = splitShares(pact, data.total, payers);
  if (!shares) return null;
  const allIn = members.every((m) => m.status === "committed" || m.status === "declined");
  const state = allIn ? "armed" : "collecting";
  return {
    ...data,
    shares,
    pact: { ...pact, state, updatedAt: now.toISOString() },
  };
}

/** `j•••@example.com`: enough for a member to recognise their own account. */
export function maskEmail(email: string | null | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.indexOf("@");
  if (at < 1) return undefined;
  return `${email[0]}•••${email.slice(at)}`;
}
