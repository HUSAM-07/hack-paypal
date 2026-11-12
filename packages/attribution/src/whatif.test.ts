import { type AttributedSale, COMMISSION_BPS } from "@pact/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createCredits } from "./ledger";
import { coalitionValueFrom } from "./shapley";
import { commissionWhatIf, type WhatIfBrand } from "./whatif";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const WINIX = "100000000001";
const T0 = "2026-11-01T00:00:00.000Z";

const sale = (i: number, over: Partial<AttributedSale> = {}): AttributedSale => ({
  captureId: `cap${String(i).padStart(3, "0")}`,
  orderId: `ord${i}`,
  shopId: "lumen",
  upc: WINIX,
  amount: usd(9599),
  sessionId: `s${i}`,
  arm: "test",
  creatorsSeen: ["housefresh"],
  model: "gpt",
  capturedAt: new Date(Date.parse(T0) + i * 1000).toISOString(),
  ...over,
});

const brand = (over: Partial<WhatIfBrand> = {}): WhatIfBrand => ({
  brandId: "winix",
  upc: WINIX,
  currency: "USD",
  causedUnits: 51,
  sales: Array.from({ length: 57 }, (_, i) => sale(i)),
  selfDealtSales: [],
  coalitions: { housefresh: 0.4 },
  ...over,
});

const at = (bps: number, depositMinor = 100_000) => ({ commissionBps: bps, depositMinor });

describe("commissionWhatIf at today's rate", () => {
  it("reproduces the ledger: 51 caused units, $391.64 credited, the same credits createCredits makes", () => {
    const b = brand();
    const r = commissionWhatIf(b, at(COMMISSION_BPS));
    expect(r.causedUnits).toBe(51);
    expect(r.credited.amountMinor).toBe(39_164);
    const ledger = createCredits({
      sales: b.sales,
      brands: [
        {
          brandId: "winix",
          upc: WINIX,
          units: 51,
          deposit: {
            id: "d",
            brandId: "winix",
            category: "purifier",
            captureId: "c",
            deposited: usd(100_000),
            spent: usd(0),
            returned: usd(0),
          },
        },
      ],
      coalitionValue: () => coalitionValueFrom({ "": 0, housefresh: 0.4 }),
    });
    expect(r.credits.map((c) => [c.id, c.amount.amountMinor])).toEqual(
      ledger.map((c) => [c.id, c.amount.amountMinor]),
    );
  });

  it("keeps what really happened: a refund-voided credit stays voided, a paid one stays paid", () => {
    const states = new Map<string, "paid" | "voided" | "pending">([
      ["cap000:housefresh", "voided"],
      ["cap001:housefresh", "paid"],
    ]);
    const r = commissionWhatIf(brand(), at(COMMISSION_BPS), { states });
    expect(r.voided.amountMinor).toBe(768);
    expect(r.kept.amountMinor).toBe(39_164 - 768);
    // $391.64 − $7.68 = the $383.96 the demo pays on day 30.
    expect(r.kept.amountMinor).toBe(38_396);
    // The unspent deposit: $1,000.00 − $383.96, as the day-30 statement says.
    expect(r.refunded.amountMinor).toBe(100_000 - 38_396);
  });

  it("counts only the credits of the scope it is given", () => {
    const inScope = new Set(["cap000:housefresh", "cap001:housefresh"]);
    const r = commissionWhatIf(brand(), at(COMMISSION_BPS), { inScope });
    expect(r.causedUnits).toBe(2);
    expect(r.credited.amountMinor).toBe(768 + 768);
  });
});

describe("commissionWhatIf at another rate or deposit", () => {
  it("re-prices every sale: 10% of $95.99 is $9.59, rounded down per the cumulative rule", () => {
    const r = commissionWhatIf(brand(), at(1000));
    expect(r.causedUnits).toBe(51);
    // 51 sales at 10%: Σ amount·bps rounds once on the running total.
    expect(r.credited.amountMinor).toBe(Math.round((51 * 9599 * 1000) / 10_000));
    expect(r.costPerCausedSale?.amountMinor).toBe(Math.round(r.kept.amountMinor / 51));
  });

  it("pays nothing at 0%, and refunds the whole deposit", () => {
    const r = commissionWhatIf(brand(), at(0));
    expect(r.credits).toEqual([]);
    expect(r.causedUnits).toBe(0);
    expect(r.costPerCausedSale).toBeNull();
    expect(r.refunded.amountMinor).toBe(100_000);
  });

  it("never credits more than the deposit, and the sales it runs out on are not credited", () => {
    const r = commissionWhatIf(brand(), at(COMMISSION_BPS, 5_000));
    expect(r.credited.amountMinor).toBe(5_000);
    expect(r.refunded.amountMinor).toBe(0);
    expect(r.causedUnits).toBeLessThan(51);
  });

  it("splits a co-exposed sale by Shapley and the shares add up to the commission", () => {
    const b = brand({
      causedUnits: 1,
      sales: [sale(0, { creatorsSeen: ["airlab", "housefresh"] })],
      coalitions: { airlab: 0.2, housefresh: 0.2, "airlab+housefresh": 0.4 },
    });
    const r = commissionWhatIf(b, at(1200));
    expect(r.credits).toHaveLength(2);
    const commission = Math.round((9599 * 1200) / 10_000);
    expect(r.credited.amountMinor).toBe(commission);
    expect(r.creators.map((c) => c.creatorId)).toEqual(["airlab", "housefresh"]);
    expect(
      Math.abs((r.creators[0]?.kept.amountMinor ?? 0) - (r.creators[1]?.kept.amountMinor ?? 0)),
    ).toBeLessThanOrEqual(1);
  });

  it("credits a self-purchase apart and keeps it out of the caused units and the cost per sale", () => {
    const b = brand({
      causedUnits: 2,
      sales: [sale(0), sale(1)],
      selfDealtSales: [sale(2)],
    });
    const r = commissionWhatIf(b, at(COMMISSION_BPS));
    expect(r.credits.map((c) => c.captureId)).toEqual(["cap000", "cap001", "cap002"]);
    expect(r.causedUnits).toBe(2);
    expect(r.credited.amountMinor).toBe(3 * 768);
    expect(r.costPerCausedSale?.amountMinor).toBe(768);
  });

  it("refuses a rate that is not whole basis points between 0% and 100%", () => {
    expect(() => commissionWhatIf(brand(), at(-1))).toThrow();
    expect(() => commissionWhatIf(brand(), at(10_001))).toThrow();
    expect(() => commissionWhatIf(brand(), at(12.5))).toThrow();
  });

  it("does not change its inputs", () => {
    const b = brand();
    const before = JSON.stringify(b);
    commissionWhatIf(b, at(1500, 3_000));
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe("commissionWhatIf properties", () => {
  it("a higher rate never pays creators less, and what the creators earn plus what is refunded is the deposit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 200_000 }),
        (a, b, deposit) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const low = commissionWhatIf(brand(), at(lo, deposit));
          const high = commissionWhatIf(brand(), at(hi, deposit));
          expect(high.kept.amountMinor).toBeGreaterThanOrEqual(low.kept.amountMinor);
          expect(high.kept.amountMinor + high.refunded.amountMinor).toBe(deposit);
          expect(high.kept.amountMinor).toBeLessThanOrEqual(deposit);
        },
      ),
      { numRuns: 60 },
    );
  });
});
