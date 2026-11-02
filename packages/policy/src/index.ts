/**
 * The policy engine. The model proposes; this decides.
 *
 * Pure and deterministic: same inputs, same decision. Every PayPal-mutating path in the
 * worker must call `authorize()` first; no agent tool bypasses it.
 *
 * Reasons split into two classes:
 *  - hard: merchant/category/currency/pact-scope violations. Always deny.
 *  - soft: limits, expiry, revocation, missing mandate. A human who is present can
 *    override with a fresh approval; an unattended (scheduled) spend is denied.
 */
import type { DenyReason, Mandate, PolicyDecision, SpendIntent } from "@pact/protocol";

export interface LedgerEntry {
  mandateId: string;
  amountMinor: number;
  currency: string;
  at: string;
}

const HARD: ReadonlySet<DenyReason> = new Set([
  "currency_mismatch",
  "merchant_denied",
  "merchant_not_allowed",
  "category_not_allowed",
  "wrong_pact",
]);

const PERIOD_MS = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 } as const;

/** Problems with one mandate for one intent; empty means the mandate covers it. */
export function check(
  intent: SpendIntent,
  mandate: Mandate,
  ledger: readonly LedgerEntry[],
  now: Date,
): DenyReason[] {
  const reasons: DenyReason[] = [];
  const t = now.getTime();

  if (mandate.pactId !== undefined && mandate.pactId !== intent.pactId) reasons.push("wrong_pact");
  if (mandate.maxPerCharge.currency !== intent.amount.currency) reasons.push("currency_mismatch");

  const merchant = intent.merchant.toLowerCase();
  if (mandate.merchantDeny?.some((m) => m.toLowerCase() === merchant))
    reasons.push("merchant_denied");
  if (mandate.merchantAllow && !mandate.merchantAllow.some((m) => m.toLowerCase() === merchant)) {
    reasons.push("merchant_not_allowed");
  }
  if (mandate.categories && (!intent.category || !mandate.categories.includes(intent.category))) {
    reasons.push("category_not_allowed");
  }

  if (mandate.status === "revoked") reasons.push("mandate_revoked");
  if (mandate.status === "expired" || t > Date.parse(mandate.validUntil))
    reasons.push("mandate_expired");
  if (t < Date.parse(mandate.validFrom)) reasons.push("mandate_not_started");

  const amount = intent.amount.amountMinor;
  if (amount > mandate.maxPerCharge.amountMinor) reasons.push("over_per_charge");

  const charges = ledger.filter((e) => e.mandateId === mandate.id);
  if (mandate.maxCharges !== undefined && charges.length >= mandate.maxCharges) {
    reasons.push("over_charge_count");
  }

  // maxTotal is per rolling period when a period is set, otherwise lifetime.
  const windowStart =
    mandate.period === "none" ? Number.NEGATIVE_INFINITY : t - PERIOD_MS[mandate.period];
  const spent = charges
    .filter((e) => Date.parse(e.at) > windowStart)
    .reduce((sum, e) => sum + e.amountMinor, 0);
  if (spent + amount > mandate.maxTotal.amountMinor) {
    reasons.push(mandate.period === "none" ? "over_total" : "over_period");
  }
  if (mandate.status === "exhausted" && !reasons.includes("over_total")) reasons.push("over_total");

  return reasons;
}

export function authorize(
  intent: SpendIntent,
  mandates: readonly Mandate[],
  ledger: readonly LedgerEntry[],
  now: Date = new Date(),
): PolicyDecision {
  const unattended = intent.initiatedBy === "schedule";
  // A mandate scoped to another pact says nothing about this spend, so it isn't a
  // candidate (rather than a hard `wrong_pact` deny that would block a present human).
  // Pact-scoped mandates go first: the most specific permission wins.
  const candidates = mandates
    .filter(
      (m) => m.userId === intent.userId && (m.pactId === undefined || m.pactId === intent.pactId),
    )
    .sort((a, b) => Number(b.pactId !== undefined) - Number(a.pactId !== undefined));

  if (candidates.length === 0) {
    return unattended
      ? { outcome: "deny", reasons: ["no_mandate"] }
      : { outcome: "needs_approval", reasons: ["no_mandate"] };
  }

  let best: { mandate: Mandate; reasons: DenyReason[] } | undefined;
  for (const mandate of candidates) {
    const reasons = check(intent, mandate, ledger, now);
    if (reasons.length === 0) {
      const stepUp =
        mandate.stepUpAbove && intent.amount.amountMinor >= mandate.stepUpAbove.amountMinor;
      return stepUp
        ? { outcome: "needs_approval", mandateId: mandate.id, reasons: ["step_up_required"] }
        : { outcome: "allow", mandateId: mandate.id };
    }
    const hardCount = reasons.filter((r) => HARD.has(r)).length;
    const bestHard = best
      ? best.reasons.filter((r) => HARD.has(r)).length
      : Number.POSITIVE_INFINITY;
    if (!best || hardCount < bestHard) best = { mandate, reasons };
  }

  // `best` is set: candidates is non-empty and every iteration either returned or assigned.
  const { mandate, reasons } = best as { mandate: Mandate; reasons: DenyReason[] };
  if (unattended || reasons.some((r) => HARD.has(r))) {
    return { outcome: "deny", reasons: reasons as [DenyReason, ...DenyReason[]] };
  }
  return { outcome: "needs_approval", mandateId: mandate.id, reasons };
}

/**
 * Split a total as evenly as possible without exceeding any member's cap ("water-filling").
 * Parts always sum exactly to the total. Returns null when the caps can't cover it.
 */
export function splitEqual(
  totalMinor: number,
  members: readonly { userId: string; capMinor: number }[],
): Map<string, number> | null {
  const shares = new Map<string, number>(members.map((m) => [m.userId, 0]));
  let remaining = totalMinor;
  // Lowest caps first: anyone who can't afford the fair share pays their cap and
  // the rest is re-divided among the members still open.
  const byCap = [...members].sort((a, b) => a.capMinor - b.capMinor);
  byCap.forEach((m, i) => {
    const give = Math.min(m.capMinor, Math.floor(remaining / (byCap.length - i)));
    shares.set(m.userId, give);
    remaining -= give;
  });
  // Flooring can strand a few cents; hand them to whoever still has headroom.
  for (const m of members) {
    if (remaining === 0) break;
    const room = m.capMinor - (shares.get(m.userId) ?? 0);
    const give = Math.min(room, remaining);
    shares.set(m.userId, (shares.get(m.userId) ?? 0) + give);
    remaining -= give;
  }
  return remaining === 0 ? shares : null;
}

/**
 * Split a total in proportion to weights without exceeding any member's cap. A member
 * whose proportional part would pass their cap pays the cap, and the rest is re-divided
 * among the others by weight. Cents left by rounding go to the largest remainders that
 * still have headroom. Parts always sum exactly to the total; null when caps can't cover it.
 */
export function splitWeighted(
  totalMinor: number,
  members: readonly { userId: string; weight: number; capMinor: number }[],
): Map<string, number> | null {
  if (members.some((m) => !(m.weight > 0))) return null;
  const shares = new Map<string, number>(members.map((m) => [m.userId, 0]));
  let open = [...members];
  let remaining = totalMinor;
  // Each pass either settles everyone left or pins at least one member at their cap.
  for (;;) {
    const weight = open.reduce((s, m) => s + m.weight, 0);
    const over = open.filter((m) => (remaining * m.weight) / weight > m.capMinor);
    if (over.length === 0) break;
    for (const m of over) {
      shares.set(m.userId, m.capMinor);
      remaining -= m.capMinor;
    }
    open = open.filter((m) => !over.includes(m));
    if (open.length === 0) return remaining === 0 ? shares : null;
  }
  const weight = open.reduce((s, m) => s + m.weight, 0);
  const exact = open.map((m) => ({ m, part: (remaining * m.weight) / weight }));
  for (const { m, part } of exact) shares.set(m.userId, Math.floor(part));
  let left = remaining - exact.reduce((s, { part }) => s + Math.floor(part), 0);
  const byRemainder = [...exact].sort(
    (a, b) => b.part - Math.floor(b.part) - (a.part - Math.floor(a.part)),
  );
  for (const { m } of byRemainder) {
    if (left === 0) break;
    if ((shares.get(m.userId) ?? 0) < m.capMinor) {
      shares.set(m.userId, (shares.get(m.userId) ?? 0) + 1);
      left -= 1;
    }
  }
  return left === 0 ? shares : null;
}
