import type { Money } from "@pact/protocol";

/**
 * Lift of a coalition of creators. `[]` is the empty set and must be 0.
 * Called with subsets in canonical (sorted) order.
 */
export type CoalitionValue = (subset: readonly string[]) => number;

/** Build a CoalitionValue from `{ "": 0, "A": .2, "B": .1, "A+B": .25 }` (ids sorted, joined by "+"). */
export function coalitionValueFrom(table: Readonly<Record<string, number>>): CoalitionValue {
  return (subset) => {
    const key = [...subset].sort().join("+");
    const v = table[key];
    if (v === undefined) throw new Error(`missing lift for coalition "${key}"`);
    return v;
  };
}

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

/** Shapley value per creator. Negative lifts count as 0 (a coalition can't have caused less than nothing). */
export function shapleyValues(
  creators: readonly string[],
  value: CoalitionValue,
): Map<string, number> {
  const ids = [...new Set(creators)].sort();
  if (ids.length !== creators.length) throw new Error("duplicate creator id");
  if (ids.length > 4) throw new Error("at most 4 creators per sale");
  const n = ids.length;
  const v = (mask: number): number => {
    const subset = ids.filter((_, i) => mask & (1 << i));
    return Math.max(0, value(subset));
  };
  const out = new Map<string, number>();
  ids.forEach((id, i) => {
    let phi = 0;
    for (let mask = 0; mask < 1 << n; mask++) {
      if (mask & (1 << i)) continue;
      let size = 0;
      for (let m = mask; m; m &= m - 1) size++;
      const weight = (factorial(size) * factorial(n - size - 1)) / factorial(n);
      phi += weight * (v(mask | (1 << i)) - v(mask));
    }
    out.set(id, phi);
  });
  return out;
}

const EPS = 1e-12;

/**
 * Split one sale's commission across co-exposed creators by Shapley value.
 *
 * - Shares sum exactly to `commission.amountMinor` (largest-remainder rounding)
 *   whenever any creator has a positive Shapley value; otherwise everyone gets 0.
 * - Computed over creators in sorted-id order and ties broken by id, so the result
 *   doesn't depend on input order.
 * - A creator with no marginal contribution gets exactly 0; leftover minor units go
 *   only to creators with a positive share.
 */
export function splitCommission(
  commission: Money,
  creators: readonly string[],
  value: CoalitionValue,
): Map<string, Money> {
  const phi = shapleyValues(creators, value);
  const ids = [...phi.keys()]; // sorted
  const positive = ids.filter((id) => (phi.get(id) ?? 0) > EPS);
  const shares = new Map<string, number>(ids.map((id) => [id, 0]));
  const total = positive.reduce((a, id) => a + (phi.get(id) ?? 0), 0);

  if (total > EPS && commission.amountMinor > 0) {
    const quotas = positive.map((id) => {
      const q = (commission.amountMinor * (phi.get(id) ?? 0)) / total;
      return { id, floor: Math.floor(q), rem: q - Math.floor(q) };
    });
    let left = commission.amountMinor - quotas.reduce((a, q) => a + q.floor, 0);
    const order = [...quotas].sort((a, b) => b.rem - a.rem || (a.id < b.id ? -1 : 1));
    for (let i = 0; left > 0; i = (i + 1) % order.length, left--) {
      const q = order[i];
      if (q) q.floor += 1;
    }
    for (const q of quotas) shares.set(q.id, q.floor);
  }

  return new Map(
    ids.map((id) => [id, { amountMinor: shares.get(id) ?? 0, currency: commission.currency }]),
  );
}
