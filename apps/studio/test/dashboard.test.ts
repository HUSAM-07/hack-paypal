import { describe, expect, it } from "vitest";
import { buildDashboard, createStudioApp, type RawEngine } from "../src/index";

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

const raw: RawEngine = {
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

describe("buildDashboard", () => {
  const d = buildDashboard(raw);
  const winix = d.brands.find((b) => b.brandId === "winix");

  it("reports caused units, arm shares and the ledger per brand", () => {
    expect(winix?.causedUnits).toBe(2);
    expect(winix?.arms.map((a) => [a.arm, a.share])).toEqual([
      ["test", 1],
      ["placebo", 0.25],
      ["none", 0],
    ]);
    expect(winix).toMatchObject({ credited: 768 + 500 + 268, voided: 768, paid: 768 });
    expect(winix?.deposit).toMatchObject({ initial: 100000, topUps: 50000, returned: 99232 });
  });

  it("gives a brand without deposits or credits zeros, not gaps", () => {
    const levoit = d.brands.find((b) => b.brandId === "levoit");
    expect(levoit).toMatchObject({ causedUnits: 0, paid: 0, deposit: { deposited: 0 } });
  });

  it("splits co-exposed sales across every creator and keeps void reasons", () => {
    const hf = d.creators.find((c) => c.creatorId === "housefresh");
    expect(hf?.credits.find((x) => x.captureId === "C2")?.split.map((s) => s.name)).toEqual([
      "HouseFresh",
      "Other Lab",
    ]);
    expect(hf?.credits.find((x) => x.state === "voided")?.voidReason).toBe("refund");
  });

  it("turns a cross-store journey into priced hops", () => {
    expect(d.journeys[0]).toMatchObject({
      product: "Winix",
      hops: [
        { shop: "northwind", priceMinor: 9999 },
        { shop: "lumen", priceMinor: 9599 },
      ],
      commissionMinor: 768,
      shares: [{ name: "HouseFresh", amountMinor: 768 }],
    });
  });
});

describe("studio app", () => {
  const app = createStudioApp({ read: async () => raw });

  it("serves both views with AG Grid and the polling script", async () => {
    for (const path of ["/", "/creator"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("ag-grid-enterprise@");
      expect(html).toContain("/api/dashboard");
    }
  });

  it("serves the dashboard JSON", async () => {
    const res = await app.request("/api/dashboard");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { brands: unknown[] }).brands).toHaveLength(2);
  });

  it("answers 503 when the engine is down", async () => {
    const down = createStudioApp({
      read: async () => {
        const { EngineUnavailable } = await import("../src/dashboard");
        throw new EngineUnavailable("down");
      },
    });
    expect((await down.request("/api/dashboard")).status).toBe(503);
  });
});
