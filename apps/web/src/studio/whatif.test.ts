import type { RawWhatIf } from "@cited/studio/tables";
import { describe, expect, it } from "vitest";
import { whatIfStore } from "./context";
import { COMMISSION_BPS, toMinor, whatIfFor } from "./whatif";

const sale = (i: number) => ({
  captureId: `cap${i}`,
  orderId: `ord${i}`,
  shopId: "lumen",
  upc: "100000000001",
  amount: { amountMinor: 9599, currency: "USD" },
  sessionId: `s${i}`,
  arm: "test" as const,
  creatorsSeen: ["housefresh"],
  model: "gpt",
  capturedAt: `2026-11-01T00:00:0${i}.000Z`,
});

const data: RawWhatIf = {
  truncated: false,
  brands: [
    {
      brandId: "winix",
      upc: "100000000001",
      currency: "USD",
      causedUnits: 3,
      sales: [sale(0), sale(1), sale(2), sale(3)],
      selfDealtSales: [],
      coalitions: { housefresh: 0.4 },
    },
  ],
};

// What the credits table says really happened: cap0 was refunded, cap1 went out in the first payout.
const credits = [
  { id: "cap0:housefresh", state: "voided", firstPayout: true },
  { id: "cap1:housefresh", state: "paid", firstPayout: true },
  { id: "cap2:housefresh", state: "held", firstPayout: false },
];

const at = (bps: number, depositMinor = 100_000) => ({ commissionBps: bps, depositMinor });

describe("whatIfFor", () => {
  it("at today's rate, gives today's numbers for the whole programme", () => {
    const r = whatIfFor(data, "winix", "todate", credits, at(COMMISSION_BPS));
    expect(r?.causedUnits).toBe(3);
    expect(r?.credited.amountMinor).toBe(3 * 768);
    expect(r?.voided.amountMinor).toBe(768);
    expect(r?.kept.amountMinor).toBe(2 * 768);
  });

  it("for the first payout, counts only the credits that cycle covered", () => {
    const r = whatIfFor(data, "winix", "first", credits, at(COMMISSION_BPS));
    expect(r?.causedUnits).toBe(2);
    expect(r?.credited.amountMinor).toBe(2 * 768);
    expect(r?.kept.amountMinor).toBe(768);
  });

  it("changes only the amounts when the rate moves: the voided credit stays voided", () => {
    const r = whatIfFor(data, "winix", "todate", credits, at(1200));
    expect(r?.causedUnits).toBe(3);
    expect(r?.voided.amountMinor).toBeGreaterThan(768);
    expect(r?.credits.find((c) => c.id === "cap0:housefresh")?.state).toBe("voided");
    expect(r?.credits.find((c) => c.id === "cap1:housefresh")?.state).toBe("paid");
    expect(r?.credits.find((c) => c.id === "cap2:housefresh")?.state).toBe("pending");
  });

  it("is null while the recorded sales are missing or the brand has none", () => {
    expect(whatIfFor(null, "winix", "todate", credits, at(800))).toBeNull();
    expect(whatIfFor(data, "levoit", "todate", credits, at(800))).toBeNull();
  });
});

describe("toMinor", () => {
  it("turns the table's dollars into whole cents without float drift", () => {
    expect(toMinor(391.64)).toBe(39_164);
    expect(toMinor(0.29)).toBe(29);
    expect(toMinor(undefined)).toBe(0);
  });
});

describe("whatIfStore", () => {
  it("tells listeners only when the sales really changed", () => {
    let calls = 0;
    const off = whatIfStore.subscribe(() => calls++);
    whatIfStore.set(data);
    whatIfStore.set(structuredClone(data));
    expect(calls).toBe(1);
    whatIfStore.set(null);
    expect(calls).toBe(2);
    off();
  });
});
