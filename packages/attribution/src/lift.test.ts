import { commissionOn } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { attributableFraction, computeLift, creditBrand, creditedUnits } from "./lift";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

describe("card example: purifiers, Winix", () => {
  const strata = [
    {
      model: "all",
      exposed: { sessions: 56, purchases: 41 },
      placebo: { sessions: 54, purchases: 16 },
    },
  ];

  it("lift is near +44pp and the 80% bound is positive but lower", () => {
    const r = computeLift(strata);
    expect(r.exposedRate).toBeCloseTo(0.732, 3);
    expect(r.lift).toBeCloseTo(0.436, 3);
    expect(r.lowerBound).toBeGreaterThan(0.3);
    expect(r.lowerBound).toBeLessThan(r.lift);
  });

  it("derived case: 37.5pp / 73% → 51%, 200 sales → 102 units → commission", () => {
    const fraction = attributableFraction(0.375, 0.73);
    expect(fraction).toBeCloseTo(0.5137, 3);
    const units = creditedUnits(200, fraction);
    expect(units).toBe(102);
    expect(creditedUnits(200, 0.51)).toBe(102);
    // 102 × $95.99 × 8% = $783.2784. commissionOn rounds down (rule 1), so 78327 minor;
    // the card's $783.28 is the round-to-nearest figure.
    expect(commissionOn(usd(units * 9599)).amountMinor).toBe(78327);
  });
});

describe("no lift pays nothing", () => {
  it("narrow verdict: negative bound → 0 units, $0", () => {
    const r = creditBrand({
      strata: [
        {
          model: "all",
          exposed: { sessions: 40, purchases: 22 },
          placebo: { sessions: 40, purchases: 20 },
        },
      ],
      exposedSales: 200,
      unitPrice: usd(9599),
    });
    expect(r.lowerBound).toBeLessThan(0);
    expect(r.units).toBe(0);
    expect(r.commission.amountMinor).toBe(0);
  });

  it("no sessions → 0", () => {
    const r = creditBrand({ strata: [], exposedSales: 50, unitPrice: usd(9599) });
    expect(r.units).toBe(0);
    expect(r.commission.amountMinor).toBe(0);
  });

  it("placebo beats exposed → 0", () => {
    const r = creditBrand({
      strata: [
        {
          model: "m",
          exposed: { sessions: 50, purchases: 5 },
          placebo: { sessions: 50, purchases: 30 },
        },
      ],
      exposedSales: 10,
      unitPrice: usd(1000),
    });
    expect(r.units).toBe(0);
  });
});

describe("model stratification", () => {
  const strata = [
    {
      model: "gpt",
      exposed: { sessions: 20, purchases: 15 },
      placebo: { sessions: 18, purchases: 5 },
    },
    {
      model: "gemini",
      exposed: { sessions: 18, purchases: 13 },
      placebo: { sessions: 18, purchases: 6 },
    },
    {
      model: "sonnet",
      exposed: { sessions: 18, purchases: 13 },
      placebo: { sessions: 18, purchases: 5 },
    },
  ];
  it("exposes a per-model breakdown and pooled rates match the lift", () => {
    const r = computeLift(strata);
    expect(r.perModel.map((m) => m.model)).toEqual(["gpt", "gemini", "sonnet"]);
    expect(r.perModel.every((m) => m.lift > 0)).toBe(true);
    expect(r.exposedRate - r.placeboRate).toBeCloseTo(r.lift, 12);
  });
  it("skips strata missing an arm", () => {
    const r = computeLift([
      ...strata,
      {
        model: "x",
        exposed: { sessions: 0, purchases: 0 },
        placebo: { sessions: 5, purchases: 1 },
      },
    ]);
    expect(r.perModel.find((m) => m.model === "x")?.weight).toBe(0);
    expect(r.lift).toBeCloseTo(computeLift(strata).lift, 12);
  });
  it("rejects impossible counts", () => {
    expect(() =>
      computeLift([
        {
          model: "m",
          exposed: { sessions: 2, purchases: 3 },
          placebo: { sessions: 2, purchases: 0 },
        },
      ]),
    ).toThrow();
  });
});

describe("per-brand crediting", () => {
  it("each brand is credited only on its own SKU's lift", () => {
    const winix = creditBrand({
      strata: [
        {
          model: "all",
          exposed: { sessions: 56, purchases: 41 },
          placebo: { sessions: 54, purchases: 16 },
        },
      ],
      exposedSales: 100,
      unitPrice: usd(9599),
    });
    const levoit = creditBrand({
      strata: [
        {
          model: "all",
          exposed: { sessions: 56, purchases: 6 },
          placebo: { sessions: 54, purchases: 20 },
        },
      ],
      exposedSales: 100,
      unitPrice: usd(9599),
    });
    expect(winix.units).toBeGreaterThan(0);
    expect(levoit.units).toBe(0);
    expect(levoit.commission.amountMinor).toBe(0);
  });
});
