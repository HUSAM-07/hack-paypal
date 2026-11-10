import type { RawEngine } from "../src/index";

const credit = (captureId: string, creatorId: string, amountMinor: number, state: string) => ({
  id: `${captureId}:${creatorId}`,
  captureId,
  brandId: "winix",
  upc: "W",
  amountMinor,
  currency: "USD",
  state,
  voidReason: state === "voided" ? "refund" : null,
  holdUntil: "2026-12-09T00:00:00Z",
  payoutBatchId: state === "paid" ? "B1" : null,
  payoutStatus: state === "paid" ? "SUCCESS" : null,
});

export const raw: RawEngine = {
  now: "2026-12-09T00:00:00Z",
  lift: [
    {
      brandId: "winix",
      name: "Winix",
      category: "purifier",
      upc: "W",
      arms: {
        test: { sessions: 4, purchases: 4 },
        placebo: { sessions: 4, purchases: 1 },
        none: { sessions: 2, purchases: 0 },
      },
      lift: 0.75,
      lowerBound: 0.5,
      attributableFraction: 0.5,
      exposedSales: 4,
      causedUnits: 2,
    },
    {
      brandId: "levoit",
      name: "Levoit",
      category: "purifier",
      upc: "L",
      arms: {
        test: { sessions: 4, purchases: 0 },
        placebo: { sessions: 4, purchases: 3 },
        none: { sessions: 2, purchases: 2 },
      },
      lift: -0.75,
      lowerBound: -1,
      attributableFraction: 0,
      exposedSales: 0,
      causedUnits: 0,
    },
  ],
  deposits: [
    {
      brandId: "winix",
      name: "Winix",
      currency: "USD",
      deposited: 150000,
      reserved: 0,
      spent: 768,
      returned: 99232,
      available: 50000,
      deposits: [
        { id: "i", kind: "initial", amountMinor: 100000, returnedMinor: 99232 },
        { id: "t", kind: "topup", amountMinor: 50000, returnedMinor: 0 },
      ],
    },
  ],
  creators: [
    {
      creatorId: "housefresh",
      name: "HouseFresh",
      totals: { pending: 0, voided: 768, paid: 768 },
      credits: [credit("C1", "housefresh", 768, "voided"), credit("C2", "housefresh", 500, "paid")],
    },
    {
      creatorId: "other",
      name: "Other Lab",
      totals: { pending: 0, voided: 0, paid: 268 },
      credits: [credit("C2", "other", 268, "paid")],
    },
  ],
  payouts: [
    {
      senderBatchId: "cited-1",
      paypalBatchId: "B1",
      status: "SUCCESS",
      createdAt: "2026-12-09T00:00:00Z",
      items: [
        {
          creatorId: "housefresh",
          amountMinor: 500,
          currency: "USD",
          creditIds: ["C2:housefresh"],
        },
      ],
    },
  ],
  journeys: [
    {
      orderId: "O1",
      sessionId: "s1",
      model: "fake-gpt",
      arm: "test",
      storesViewed: ["northwind"],
      storeChosen: "lumen",
      items: [{ upc: "W", amountMinor: 9599, currency: "USD" }],
      priceSavedMinor: 400,
      commission: { pending: 0, paid: 768, voided: 0 },
      holdStatus: "paid",
      holdUntil: null,
      shapley: [
        { captureId: "C2", shares: [{ creatorId: "housefresh", amountMinor: 768, state: "paid" }] },
      ],
      capturedAt: "2026-11-09T00:00:00Z",
    },
  ],
};
