import { describe, expect, it } from "vitest";
import { COMMISSION_BPS } from "./cited";
import { checkProgrammeTerms, PROGRAMME_CATEGORIES, PROGRAMME_LIMITS } from "./programme";

const ok = {
  category: "robot-vacuum",
  upc: "100000000006",
  depositMinor: 50_000,
  commissionBps: 800,
};

describe("checkProgrammeTerms", () => {
  it("accepts a catalogue product and returns its programme id", () => {
    const r = checkProgrammeTerms(ok, new Set());
    expect(r).toEqual({
      ok: true,
      terms: expect.objectContaining({
        brandId: "roborock",
        category: "robot-vacuum",
        name: "Roborock",
      }),
    });
  });

  it("accepts the headphone category and refuses a product from another one", () => {
    const h = {
      category: "headphones",
      upc: "100000000021",
      depositMinor: 50_000,
      commissionBps: 800,
    };
    expect(checkProgrammeTerms(h, new Set())).toEqual({
      ok: true,
      terms: expect.objectContaining({ brandId: "bose", category: "headphones", name: "Bose" }),
    });
    expect(checkProgrammeTerms({ ...h, upc: "100000000006" }, new Set())).toMatchObject({
      error: "unknown_product",
    });
    expect(PROGRAMME_CATEGORIES.map((c) => c.id)).toEqual([
      "purifier",
      "robot-vacuum",
      "headphones",
    ]);
  });

  it("refuses a product outside the category, an unknown category and a funded product", () => {
    expect(checkProgrammeTerms({ ...ok, upc: "100000000001" }, new Set())).toMatchObject({
      error: "unknown_product",
    });
    expect(checkProgrammeTerms({ ...ok, category: "humidifier" }, new Set())).toMatchObject({
      error: "unknown_category",
    });
    expect(checkProgrammeTerms(ok, new Set([ok.upc]))).toMatchObject({ error: "programme_exists" });
  });

  it("keeps money in whole minor units inside the limits", () => {
    for (const depositMinor of [
      PROGRAMME_LIMITS.minDepositMinor - 1,
      PROGRAMME_LIMITS.maxDepositMinor + 1,
      500.5,
      Number.NaN,
    ])
      expect(checkProgrammeTerms({ ...ok, depositMinor }, new Set())).toMatchObject({
        error: "deposit_out_of_range",
      });
    for (const commissionBps of [0, 99, 2_001, 8.5])
      expect(checkProgrammeTerms({ ...ok, commissionBps }, new Set())).toMatchObject({
        error: "commission_out_of_range",
      });
  });

  it("defaults to the demo programme's rate", () => {
    expect(PROGRAMME_LIMITS.defaultCommissionBps).toBe(COMMISSION_BPS);
  });

  it("gives every product a distinct programme id and UPC", () => {
    const products = PROGRAMME_CATEGORIES.flatMap((c) => c.products);
    expect(new Set(products.map((p) => p.brandId)).size).toBe(products.length);
    expect(new Set(products.map((p) => p.upc)).size).toBe(products.length);
  });
});

describe("checkProgrammeTerms by currency", () => {
  it("defaults to dollars and takes pounds and euros", () => {
    expect(checkProgrammeTerms(ok, new Set())).toMatchObject({
      ok: true,
      terms: { currency: "USD" },
    });
    for (const currency of ["USD", "GBP", "EUR"])
      expect(checkProgrammeTerms({ ...ok, currency }, new Set())).toMatchObject({
        ok: true,
        terms: { currency, depositMinor: 50_000 },
      });
  });
  it("refuses any other currency", () => {
    for (const currency of ["JPY", "CHF", "gbp", "", "POUNDS"])
      expect(checkProgrammeTerms({ ...ok, currency }, new Set())).toMatchObject({
        ok: false,
        error: "unsupported_currency",
      });
  });
  it("states the limits in the programme's currency", () => {
    const msg = (currency: string) => {
      const r = checkProgrammeTerms({ ...ok, currency, depositMinor: 1 }, new Set());
      return r.ok ? "" : r.message;
    };
    expect(msg("USD")).toBe("The deposit must be between $100 and $10,000.");
    expect(msg("GBP")).toBe("The deposit must be between £100 and £10,000.");
    expect(msg("EUR")).toBe("The deposit must be between €100 and €10,000.");
  });
});
