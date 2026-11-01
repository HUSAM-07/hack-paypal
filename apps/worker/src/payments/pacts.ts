/** Pure pact/mandate rules for the money endpoints. No I/O; unit-tested directly. */
import { splitEqual } from "@pact/policy";
import type { Mandate, Money, Pact } from "@pact/protocol";

export interface PactRefData {
  pact: Pact;
  total: Money;
  shares: { userId: string; share: Money }[] | null;
}

const DAY_MS = 86_400_000;
const DEFAULT_MANDATE_DAYS = 90;
/** States in which a member may still commit funding or pay a share. */
const OPEN_STATES: ReadonlySet<Pact["state"]> = new Set(["draft", "collecting", "armed"]);

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
  const shares = resplit(data.total, members);
  if (!shares) return null;
  const allIn = members.every((m) => m.status === "committed" || m.status === "declined");
  const state = allIn ? "armed" : "collecting";
  return {
    total: data.total,
    shares,
    pact: { ...data.pact, members, state, updatedAt: now.toISOString() },
  };
}

function resplit(total: Money, members: Pact["members"]): PactRefData["shares"] {
  const payers = members.filter((m) => m.status !== "declined" && m.status !== "revoked");
  const parts = splitEqual(
    total.amountMinor,
    payers.map((m) => ({ userId: m.userId, capMinor: m.cap.amountMinor })),
  );
  if (!parts) return null;
  return [...parts].map(([uid, amountMinor]) => ({
    userId: uid,
    share: { amountMinor, currency: total.currency },
  }));
}

/** `j•••@example.com`: enough for a member to recognise their own account. */
export function maskEmail(email: string | null | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.indexOf("@");
  if (at < 1) return undefined;
  return `${email[0]}•••${email.slice(at)}`;
}
