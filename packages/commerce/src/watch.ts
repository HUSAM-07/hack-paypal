/**
 * Price-watch rules. Pure: the same watch, check and history always give the same decision.
 *
 * Anomalies pause instead of buying. A broken baseline (currency or variant changed) always
 * pauses. "Too good to be true" (under 40% of the trailing median) and out-of-stock only pause
 * when the price would otherwise trigger.
 */
import type { PriceCheck, Watch } from "./contract";
import { shortHash } from "./url";

export type WatchDecision =
  | { kind: "none"; reason: "inactive" | "aboveTarget" }
  | { kind: "notify" }
  | { kind: "autoBuy" }
  | { kind: "needsReview"; reason: string };

export type HistoryPoint = Watch["history"][number];

/** A live price under this share of the trailing median is suspicious (40%). */
export const ANOMALY_BPS = 4_000;
export const MEDIAN_WINDOW = 20;
export const MIN_MEDIAN_POINTS = 3;
export const HISTORY_CAP = 500;
export const MAX_INTERVAL_MINUTES = 1_440;

/** Median of the last `window` points (lower median for even counts), integers only. */
export function trailingMedian(
  history: readonly HistoryPoint[],
  window = MEDIAN_WINDOW,
): number | undefined {
  const xs = history
    .slice(-window)
    .map((p) => p.amountMinor)
    .sort((a, b) => a - b);
  if (xs.length < MIN_MEDIAN_POINTS) return undefined;
  return xs[Math.floor((xs.length - 1) / 2)];
}

export function isSuspiciouslyLow(amountMinor: number, median: number | undefined): boolean {
  return median !== undefined && amountMinor * 10_000 < median * ANOMALY_BPS;
}

export function evaluateWatch(
  watch: Watch,
  check: PriceCheck,
  history: readonly HistoryPoint[] = watch.history,
): WatchDecision {
  if (watch.status !== "active") return { kind: "none", reason: "inactive" };
  const price = check.price;
  if (price.currency !== watch.targetPrice.currency) {
    return {
      kind: "needsReview",
      reason: `The price is now in ${price.currency}, not ${watch.targetPrice.currency}.`,
    };
  }
  const prevVariant = watch.lastCheck?.variant;
  if (prevVariant && check.variant && prevVariant !== check.variant) {
    return {
      kind: "needsReview",
      reason: `The listing changed from “${prevVariant}” to “${check.variant}”.`.slice(0, 300),
    };
  }
  if (price.amountMinor > watch.targetPrice.amountMinor) {
    return { kind: "none", reason: "aboveTarget" };
  }
  if (isSuspiciouslyLow(price.amountMinor, trailingMedian(history))) {
    return {
      kind: "needsReview",
      reason: "The price is under 40% of its recent median; that's often a listing error.",
    };
  }
  if (check.inStock === false) {
    return { kind: "needsReview", reason: "It hit your price but it's out of stock." };
  }
  const rule = watch.autoBuy;
  const canAutoBuy =
    rule !== undefined &&
    rule.mandateId !== undefined &&
    watch.offer.buyable &&
    Date.parse(check.checkedAt) < Date.parse(rule.expiresAt) &&
    rule.maxUnitPrice.currency === price.currency &&
    price.amountMinor <= rule.maxUnitPrice.amountMinor;
  return canAutoBuy ? { kind: "autoBuy" } : { kind: "notify" };
}

/** Deterministic jitter in [-1, 1] from a seed, so retries spread without randomness in tests. */
function unitJitter(seed: string): number {
  const h = Number.parseInt(shortHash(seed).slice(0, 6), 36);
  return ((h % 2001) - 1000) / 1000;
}

/**
 * When to check next: every `everyMinutes`, doubled per consecutive failure (capped at a day),
 * ±10% deterministic jitter so many watches don't fire on the same second.
 */
export function nextCheckAt(
  watch: Pick<Watch, "id" | "everyMinutes">,
  now: Date,
  failures = 0,
): string {
  const minutes = Math.min(
    watch.everyMinutes * 2 ** Math.min(Math.max(failures, 0), 10),
    MAX_INTERVAL_MINUTES,
  );
  const base = minutes * 60_000;
  const jitter = Math.round(base * 0.1 * unitJitter(`${watch.id}:${now.toISOString()}`));
  return new Date(now.getTime() + base + jitter).toISOString();
}

/** Appends a point (replacing one at the same instant) and keeps the newest `cap`. */
export function appendHistory(
  history: readonly HistoryPoint[],
  point: HistoryPoint,
  cap = HISTORY_CAP,
): HistoryPoint[] {
  const last = history[history.length - 1];
  const base = last && last.at === point.at ? history.slice(0, -1) : history;
  return [...base, point].slice(-cap);
}
