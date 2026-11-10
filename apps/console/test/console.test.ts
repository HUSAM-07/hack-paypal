import { describe, expect, it } from "vitest";
import { createEngineClient } from "../src/engine";
import { createConsoleApp } from "../src/index";
import { type AgentRun, parseRunRecords, pickPair, type RunSource } from "../src/runs";

const record = (o: Record<string, unknown>) =>
  JSON.stringify({
    sessionId: "sess-1",
    runIndex: 0,
    seed: "s",
    request: "Small bedroom purifier, light sleeper, around $100, just buy it",
    family: "gpt",
    model: "fake-gpt",
    provider: "fake",
    arm: "test",
    creatorsSeen: ["housefresh"],
    storesViewed: ["northwind", "lumen"],
    searches: 2,
    product: { upc: "111111111111", name: "Winix A230" },
    shop: "lumen",
    orderId: "ORD-W",
    captureId: "CAP-W",
    total: { amountMinor: 9599, currency: "USD" },
    passportAttached: true,
    reason: "cheaper",
    status: "purchased",
    ...o,
  });

const RUNS = [
  record({}),
  record({
    sessionId: "sess-2",
    arm: "none",
    creatorsSeen: [],
    product: { upc: "222222222222", name: "Levoit Core 300" },
    shop: "northwind",
    storesViewed: ["northwind"],
    orderId: "ORD-L",
    total: { amountMinor: 9999, currency: "USD" },
  }),
].join("\n");

const journey = (o: Record<string, unknown>) => ({
  sessionId: "x",
  model: "fake-gpt",
  items: [],
  commission: { pending: 0, paid: 0, voided: 0 },
  holdStatus: "none",
  holdUntil: null,
  capturedAt: "2026-11-02T10:00:00.000Z",
  ...o,
});

const ENGINE: Record<string, unknown> = {
  "/api/journeys": {
    journeys: [
      journey({
        orderId: "ORD-W",
        arm: "test",
        storesViewed: ["northwind", "lumen"],
        storeChosen: "lumen",
        priceSavedMinor: 400,
        commission: { pending: 768, paid: 0, voided: 0 },
        holdStatus: "held",
      }),
      journey({
        orderId: "ORD-L",
        arm: "none",
        storesViewed: ["northwind"],
        storeChosen: "northwind",
        priceSavedMinor: 0,
      }),
    ],
  },
  "/api/payouts": {
    batches: [
      {
        senderBatchId: "cited-abcdef0123456789",
        paypalBatchId: "PAYOUT-BATCH-77",
        status: "SUCCESS",
        items: [
          {
            creatorId: "housefresh",
            receiver: "HOUSEFRESH-PP",
            amountMinor: 39164,
            currency: "USD",
            creditIds: [],
            payoutItemId: "ITEM-9",
          },
        ],
        createdAt: "2026-12-02T00:00:00.000Z",
      },
    ],
  },
  "/api/credits": {
    creators: [
      {
        creatorId: "housefresh",
        name: "HouseFresh",
        totals: { pending: 0, voided: 0, paid: 39164 },
        credits: [{ brandId: "winix", amountMinor: 39164, state: "paid" }],
      },
    ],
  },
  "/api/lift": {
    brands: [
      { brandId: "winix", name: "Winix", exposedSales: 57, causedUnits: 51, lowerBound: 0.9 },
      { brandId: "levoit", name: "Levoit", exposedSales: 3, causedUnits: 0, lowerBound: -0.06 },
    ],
  },
};

function appWith(runs: string, engine: Record<string, unknown> | "down" = ENGINE) {
  const fakeFetch = (async (url: string) => {
    if (engine === "down") throw new Error("refused");
    const path = new URL(url).pathname;
    return Response.json(engine[path] ?? {}, { status: engine[path] ? 200 : 404 });
  }) as unknown as typeof fetch;
  const source: RunSource = { runs: async () => parseRunRecords(runs) };
  return createConsoleApp({
    engine: createEngineClient({ baseUrl: "http://engine", fetch: fakeFetch }),
    runs: source,
  });
}

describe("run source", () => {
  it("skips a half-written line and pairs the test run with the held-out run", () => {
    const runs = parseRunRecords(`${RUNS}\n{"request": "tru`);
    expect(runs).toHaveLength(2);
    const { exposed, heldOut } = pickPair(runs);
    expect(exposed?.product?.name).toBe("Winix A230");
    expect(heldOut?.product?.name).toBe("Levoit Core 300");
  });

  it("reads the seller an agent paid through PayPal", () => {
    const [r] = parseRunRecords(record({ shop: undefined, seller: "megamart" }));
    expect(r?.shop).toBe("megamart");
  });
});

describe("picking the video pair", () => {
  const run = (o: Record<string, unknown>) => parseRunRecords(record(o))[0] as AgentRun;
  const winix = { upc: "111111111111", name: "Winix A230" };
  const levoit = { upc: "222222222222", name: "Levoit Core 300" };

  it("prefers a credited, cross-shop exposed run and a held-out run that bought the other purifier", () => {
    const runs = [
      run({ orderId: "ORD-A", storesViewed: ["northwind"], shop: "lumen" }),
      run({ orderId: "ORD-B", storesViewed: ["lumen"], shop: "lumen" }),
      run({ orderId: "ORD-C", storesViewed: ["megamart"], shop: "lumen" }),
      run({ arm: "none", orderId: "ORD-D", product: levoit }),
      run({ arm: "none", orderId: "ORD-E", product: winix }),
    ];
    const { exposed, heldOut } = pickPair(runs, new Set(["ORD-A", "ORD-B"]));
    expect(exposed?.orderId).toBe("ORD-A");
    expect(heldOut?.orderId).toBe("ORD-D");
  });

  it("falls back to the latest runs when nothing tells the story", () => {
    const runs = [
      run({ orderId: "ORD-A", storesViewed: ["lumen"] }),
      run({ orderId: "ORD-B", storesViewed: ["lumen"] }),
      run({ arm: "none", orderId: "ORD-C", product: winix }),
    ];
    const { exposed, heldOut } = pickPair(runs);
    expect(exposed?.orderId).toBe("ORD-B");
    expect(heldOut?.orderId).toBe("ORD-C");
  });
});

describe("side-by-side runs (#28)", () => {
  it("shows both runs, the Northwind → Lumen hop and the engine's order", async () => {
    const html = await (await appWith(RUNS).request("/")).text();
    expect(html).toContain("Winix A230");
    expect(html).toContain("Levoit Core 300");
    expect(html).toMatch(
      /Northwind<small>Read the test on this offer[\s\S]*Passport[\s\S]*→[\s\S]*Lumen<small>Paid through PayPal/,
    );
    expect(html).toContain("offer was $4.00 under");
    expect(html).toContain("the buyer’s saved PayPal");
    expect(html).toContain("Order ORD-W");
    expect(html).toContain("Caused by the test");
    expect(html).toContain("$7.68 commission</span> · held 30 days");
    expect(html).toContain("No commission");
  });

  it("says so when the engine is unreachable instead of inventing an order", async () => {
    const html = await (await appWith(RUNS, "down").request("/")).text();
    expect(html).toContain("Engine not reachable");
    expect(html).toContain("waiting for the engine");
  });

  it("shows a waiting state with no runs", async () => {
    const html = await (await appWith("").request("/")).text();
    expect(html).toContain("No agent runs yet");
  });
});

describe("payout moment (#29)", () => {
  it("shows the engine's amount, the batch and item ids, and the no-lift line", async () => {
    const html = await (await appWith(RUNS).request("/payout")).text();
    expect(html).toContain("$391.64");
    expect(html).toContain("PAYOUT-BATCH-77");
    expect(html).toContain("ITEM-9");
    expect(html).toContain("Levoit");
    expect(html).toContain("$0.00 paid · no lift");
    expect(html).not.toContain("differs from this payout");
  });

  it("flags a payout that disagrees with the ledger", async () => {
    const bad = structuredClone(ENGINE) as any;
    bad["/api/credits"].creators[0].totals.paid = 100;
    const html = await (await appWith(RUNS, bad).request("/payout")).text();
    expect(html).toContain("differs from this payout");
  });

  it("answers 503 when the engine is down", async () => {
    expect((await appWith(RUNS, "down").request("/payout")).status).toBe(503);
  });

  it("shows the day-30 payout by default when later batches exist; ?batch and ?creator pick others", async () => {
    const later = structuredClone(ENGINE) as any;
    const batch = (id: string, at: string, items: any[]) => ({
      senderBatchId: `cited-${id}`,
      paypalBatchId: `PAYOUT-${id}`,
      status: "SUCCESS",
      items,
      createdAt: at,
    });
    const item = (creatorId: string, receiver: string, amountMinor: number) => ({
      creatorId,
      receiver,
      amountMinor,
      currency: "USD",
      creditIds: [],
    });
    later["/api/payouts"].batches = [
      batch("first", "2026-12-02T00:00:00.000Z", [item("housefresh", "HOUSEFRESH-PP", 38_396)]),
      batch("day60", "2027-01-01T00:00:00.000Z", [
        item("airlab", "AIRLAB-PP", 1_536),
        item("housefresh", "HOUSEFRESH-PP", 6_143),
      ]),
    ];
    later["/api/credits"].creators = [
      {
        creatorId: "airlab",
        name: "AirLab",
        totals: { pending: 0, voided: 0, paid: 1_536 },
        credits: [
          { brandId: "winix", amountMinor: 1_536, state: "paid", payoutBatchId: "PAYOUT-day60" },
        ],
      },
      {
        creatorId: "housefresh",
        name: "HouseFresh",
        totals: { pending: 0, voided: 768, paid: 44_539 },
        credits: [
          { brandId: "winix", amountMinor: 38_396, state: "paid", payoutBatchId: "PAYOUT-first" },
          { brandId: "winix", amountMinor: 768, state: "voided", payoutBatchId: null },
          { brandId: "winix", amountMinor: 6_143, state: "paid", payoutBatchId: "PAYOUT-day60" },
        ],
      },
    ];
    const app = appWith(RUNS, later);
    const first = await (await app.request("/payout")).text();
    expect(first).toContain("$383.96");
    expect(first).not.toContain("differs from this payout");
    const latest = await (await app.request("/payout?creator=housefresh&batch=latest")).text();
    expect(latest).toContain("$61.43");
    expect(latest).not.toContain("differs from this payout");
    const airlab = await (await app.request("/payout?creator=airlab")).text();
    expect(airlab).toContain("$15.36");
    expect(airlab).toContain("AirLab");
  });
});
