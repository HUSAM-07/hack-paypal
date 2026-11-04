import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { coalitionValueFrom, shapleyValues, splitCommission } from "./shapley";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const sum = (m: Map<string, { amountMinor: number }>) =>
  [...m.values()].reduce((a, x) => a + x.amountMinor, 0);

describe("splitCommission", () => {
  it("one creator takes everything", () => {
    const v = coalitionValueFrom({ "": 0, A: 0.4 });
    expect(splitCommission(usd(783), ["A"], v).get("A")?.amountMinor).toBe(783);
  });

  it("two creators: symmetric lifts split evenly, odd cent goes by id", () => {
    const v = coalitionValueFrom({ "": 0, A: 0.2, B: 0.2, "A+B": 0.4 });
    const s = splitCommission(usd(101), ["B", "A"], v);
    expect(s.get("A")?.amountMinor).toBe(51);
    expect(s.get("B")?.amountMinor).toBe(50);
  });

  it("two creators, unequal: A alone .3, B alone .1, together .35", () => {
    const v = coalitionValueFrom({ "": 0, A: 0.3, B: 0.1, "A+B": 0.35 });
    const phi = shapleyValues(["A", "B"], v);
    expect(phi.get("A")).toBeCloseTo(0.275, 12);
    expect(phi.get("B")).toBeCloseTo(0.075, 12);
    const s = splitCommission(usd(7000), ["A", "B"], v);
    expect(s.get("A")?.amountMinor).toBe(5500);
    expect(s.get("B")?.amountMinor).toBe(1500);
  });

  it("a creator with no marginal contribution gets 0", () => {
    const v = coalitionValueFrom({ "": 0, A: 0.3, B: 0, "A+B": 0.3 });
    const s = splitCommission(usd(999), ["A", "B"], v);
    expect(s.get("B")?.amountMinor).toBe(0);
    expect(s.get("A")?.amountMinor).toBe(999);
  });

  it("three creators, additive lifts split in proportion", () => {
    const lifts = { A: 0.3, B: 0.2, C: 0.1 };
    const v = (subset: readonly string[]) =>
      subset.reduce((a, id) => a + lifts[id as keyof typeof lifts], 0);
    const s = splitCommission(usd(600), ["C", "A", "B"], v);
    expect([s.get("A")?.amountMinor, s.get("B")?.amountMinor, s.get("C")?.amountMinor]).toEqual([
      300, 200, 100,
    ]);
  });

  it("no lift at all → everyone 0", () => {
    const s = splitCommission(usd(500), ["A", "B"], () => 0);
    expect(sum(s)).toBe(0);
  });

  it("rejects duplicates and more than 4 creators", () => {
    expect(() => splitCommission(usd(1), ["A", "A"], () => 0)).toThrow();
    expect(() => splitCommission(usd(1), ["A", "B", "C", "D", "E"], () => 0)).toThrow();
  });
});

// Random coalition table over ≤3 creators.
const scenario = fc.integer({ min: 1, max: 3 }).chain((n) =>
  fc.tuple(
    fc.constant(["A", "B", "C"].slice(0, n)),
    fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
      minLength: 1 << n,
      maxLength: 1 << n,
    }),
    fc.nat(5_000_000),
  ),
);

const valueFromArray = (ids: string[], vals: number[]) => (subset: readonly string[]) => {
  const mask = ids.reduce((m, id, i) => (subset.includes(id) ? m | (1 << i) : m), 0);
  return mask === 0 ? 0 : (vals[mask] ?? 0);
};

describe("splitCommission properties", () => {
  it("sums exactly to the commission when anyone contributes, never negative", () => {
    fc.assert(
      fc.property(scenario, ([ids, vals, minor]) => {
        const v = valueFromArray(ids, vals);
        const s = splitCommission(usd(minor), ids, v);
        const total = sum(s);
        const anyContribution = [...shapleyValues(ids, v).values()].some((x) => x > 1e-12);
        expect(total).toBe(anyContribution ? minor : 0);
        for (const m of s.values()) expect(m.amountMinor).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("does not depend on creator order", () => {
    fc.assert(
      fc.property(scenario, fc.integer(), ([ids, vals, minor], seed) => {
        const v = valueFromArray(ids, vals);
        const shuffled = [...ids].sort(
          (a, b) => ((a.charCodeAt(0) * seed) % 7) - ((b.charCodeAt(0) * seed) % 7),
        );
        const a = splitCommission(usd(minor), ids, v);
        const b = splitCommission(usd(minor), shuffled, v);
        for (const id of ids) expect(b.get(id)).toEqual(a.get(id));
      }),
    );
  });

  it("a dummy creator (adds nothing to any coalition) gets 0", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.nat(1_000_000),
        (a, b, minor) => {
          const v = (subset: readonly string[]) => {
            const x = subset.includes("A") ? a : 0;
            const y = subset.includes("B") ? b : 0;
            return x + y; // C is never counted
          };
          const s = splitCommission(usd(minor), ["A", "B", "C"], v);
          expect(s.get("C")?.amountMinor).toBe(0);
          expect(sum(s)).toBe(minor);
        },
      ),
    );
  });
});
