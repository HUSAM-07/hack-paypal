import { describe, expect, it } from "vitest";
import { creatorAnswer } from "../src/creator";
import type { RawEngine } from "../src/index";
import { buildTables } from "../src/tables";
import { raw as usdRaw } from "./fixture";

const gbpCredit = (captureId: string, creatorId: string, amountMinor: number, state: string) => ({
  id: `${captureId}:${creatorId}`,
  captureId,
  brandId: "roborock",
  upc: "R",
  amountMinor,
  currency: "GBP",
  state,
  voidReason: null,
  holdUntil: "2026-12-09T00:00:00Z",
  payoutBatchId: state === "paid" ? "B2" : null,
  payoutStatus: state === "paid" ? "SUCCESS" : null,
});

/** The dollar fixture plus a pound programme: HouseFresh is credited in both, Crumblab only in pounds. */
const raw: RawEngine = {
  ...usdRaw,
  lift: [
    ...usdRaw.lift,
    {
      brandId: "roborock",
      name: "Roborock",
      category: "robot-vacuum",
      upc: "R",
      currency: "GBP",
      arms: {
        test: { sessions: 2, purchases: 2 },
        placebo: { sessions: 2, purchases: 0 },
        none: { sessions: 0, purchases: 0 },
      },
      lift: 1,
      lowerBound: 0.5,
      attributableFraction: 0.5,
      exposedSales: 2,
      causedUnits: 1,
    },
  ],
  deposits: [
    ...usdRaw.deposits,
    {
      brandId: "roborock",
      name: "Roborock",
      currency: "GBP",
      deposited: 50_000,
      reserved: 0,
      spent: 2_400,
      returned: 0,
      available: 47_600,
      deposits: [{ id: "g", kind: "initial", amountMinor: 50_000, returnedMinor: 0 }],
    },
  ],
  creators: [
    ...usdRaw.creators.map((c) =>
      c.creatorId === "housefresh"
        ? { ...c, credits: [...c.credits, gbpCredit("G1", "housefresh", 1_400, "paid")] }
        : c,
    ),
    {
      creatorId: "crumblab",
      name: "CrumbLab",
      totals: { pending: 0, voided: 0, paid: 1_000 },
      credits: [gbpCredit("G1", "crumblab", 1_000, "paid")],
    },
  ],
  payouts: [
    ...(usdRaw.payouts ?? []),
    {
      senderBatchId: "cited-2",
      paypalBatchId: "B2",
      status: "SUCCESS",
      createdAt: "2026-12-10T00:00:00Z",
      items: [
        {
          creatorId: "housefresh",
          amountMinor: 1_400,
          currency: "GBP",
          creditIds: ["G1:housefresh"],
        },
        { creatorId: "crumblab", amountMinor: 1_000, currency: "GBP", creditIds: ["G1:crumblab"] },
      ],
    },
  ],
};

describe("Studio keeps each programme in its own currency", () => {
  const t = buildTables(raw).tables;
  const rows = (id: keyof typeof t) => t[id] as Record<string, unknown>[];

  it("labels every programme row with its currency, and leaves the dollar rows as they were", () => {
    const brands = rows("brands").filter((r) => r.scopeKey === "todate");
    expect(Object.fromEntries(brands.map((r) => [r.brandId, r.currency]))).toEqual({
      winix: "USD",
      levoit: "USD",
      roborock: "GBP",
    });
    const roborock = brands.find((r) => r.brandId === "roborock");
    expect(roborock).toMatchObject({ deposited: 500, spent: 24, available: 476 });
    // The dollar programme's own figures are exactly what the dollar-only fixture gives.
    const before = buildTables(usdRaw).tables.brands?.find((r) => r.id === "winix:todate");
    expect(rows("brands").find((r) => r.id === "winix:todate")).toEqual({
      ...before,
      currency: "USD",
    });
  });

  it("never adds pounds to dollars: a creator credited in both has one row per currency", () => {
    const mine = rows("creators").filter((r) => r.creatorId === "housefresh");
    expect(mine.map((r) => [r.id, r.currency])).toEqual([
      ["housefresh", "USD"],
      ["housefresh:GBP", "GBP"],
    ]);
    expect(mine[0]).toMatchObject({ paid: 5, credits: 2 }); // $5.00, as before
    expect(mine[1]).toMatchObject({ paid: 14, credits: 1, firstPayout: 0 }); // £14.00 only
    // A creator with one currency keeps the single row they always had, id and all.
    expect(rows("creators").filter((r) => r.creatorId === "crumblab")).toEqual([
      expect.objectContaining({ id: "crumblab", currency: "GBP", paid: 10 }),
    ]);
  });

  it("carries the currency on credits, payouts, deposits and the split text", () => {
    const credit = (id: string) => rows("credits").find((r) => r.id === id);
    expect(credit("G1:housefresh")).toMatchObject({ currency: "GBP", amount: 14 });
    expect(credit("G1:housefresh")?.splitWith).toBe("CrumbLab £10.00");
    expect(credit("C2:housefresh")).toMatchObject({ currency: "USD", amount: 5 });
    expect(rows("payouts").map((r) => [r.creatorId, r.currency])).toEqual([
      ["housefresh", "USD"],
      ["housefresh", "GBP"],
      ["crumblab", "GBP"],
    ]);
    expect(rows("deposits").map((r) => [r.brandId, r.currency])).toEqual([
      ["winix", "USD"],
      ["winix", "USD"],
      ["roborock", "GBP"],
    ]);
  });
});

describe("the Creator Analyst speaks in the creator's own currency", () => {
  it("answers a pound creator in pounds, and a dollar creator in dollars", () => {
    const uk = creatorAnswer(raw, "crumblab", "overview");
    expect(uk?.summary).toMatch(/£/);
    expect(uk?.summary).not.toMatch(/\$/);
    const us = creatorAnswer(raw, "housefresh", "overview");
    expect(us?.summary).toMatch(/\$/);
    // HouseFresh's pounds are never folded into the dollar answer.
    expect(JSON.stringify(us)).not.toContain("£14");
  });
});
