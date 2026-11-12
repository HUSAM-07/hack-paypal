import { describe, expect, it } from "vitest";
import { createEngineClient } from "../src/engine";
import { createConsoleApp } from "../src/index";
import { type AgentRun, agentLabel, parseRunRecords, pickPair, type RunSource } from "../src/runs";

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

  it("prefers the scripted Northwind → Lumen run over a newer MegaMart → Lumen one", () => {
    const runs = [
      run({ orderId: "ORD-A", storesViewed: ["northwind"], shop: "lumen" }),
      run({ orderId: "ORD-B", storesViewed: ["megamart"], shop: "lumen" }),
    ];
    expect(pickPair(runs, new Set(["ORD-A", "ORD-B"])).exposed?.orderId).toBe("ORD-A");
  });

  it("labels seeded stand-in agents plainly and keeps real model ids", () => {
    expect(agentLabel("fake-gemini")).toBe("Seeded demo agent");
    expect(agentLabel("scripted-gemini")).toBe("Seeded demo agent");
    expect(agentLabel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
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
  it("plays both runs as aligned transcripts: the review, the Northwind → Lumen hop, the verdicts", async () => {
    const html = await (await appWith(RUNS).request("/")).text();
    expect(html).toContain("Without the review");
    expect(html).toContain("With HouseFresh's review");
    expect(html).toContain("Levoit Core 300</b> at Northwind");
    expect(html).toContain("HouseFresh's review, on Northwind's offer");
    expect(html).toMatch(
      /Winix A230<\/b> at Lumen · \$95\.99<small>\$4\.00 under Northwind's offer/,
    );
    expect(html).toContain("the buyer's saved PayPal");
    expect(html).toContain("order ORD-W");
    expect(html).toContain(
      "+$7.68</span><small>to HouseFresh · caused by the review · held 30 days",
    );
    expect(html).toContain("$0.00</span><small>to creators · nothing the review caused");
    // The rows the review changed are marked; the request and the checkout rail are not.
    expect(html.match(/class="eq ne"/g)?.length).toBe(4);
    expect(html.match(/class="eq"[^>]*aria-label="same"/g)?.length).toBe(2);
  });

  it("says so when the engine is unreachable instead of inventing an order", async () => {
    const html = await (await appWith(RUNS, "down").request("/")).text();
    expect(html).toContain("Engine not reachable");
    expect(html).toContain("not captured yet");
    expect(html).not.toContain("order ORD-");
  });

  it("shows a waiting state with no runs", async () => {
    const html = await (await appWith("").request("/")).text();
    expect(html).toContain("No agent runs to show yet");
    expect(html).not.toContain("CLI");
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

  it("dates the payout relative to the demo, never by the demo clock's future date", async () => {
    for (const path of ["/payout", "/payout?clean=1"]) {
      const html = await (await appWith(RUNS).request(path)).text();
      expect(html).toContain("After the 30-day hold");
      expect(html).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    }
  });

  it("carries the shared site nav, hidden with ?clean=1", async () => {
    const html = await (await appWith(RUNS).request("/payout")).text();
    for (const href of ["../try", "../mcp", "../proof", "../studio", "../creators", 'href="/"'])
      expect(html).toContain(href);
    // The payout now lives on the landing; the page stays reachable but has no nav tab of its own.
    expect(html).not.toContain('href="/payout"');
    const clean = await (await appWith(RUNS).request("/payout?clean=1")).text();
    expect(clean).toContain('class="clean');
  });

  it("says paid to Venmo for a Venmo item, and not for a PayPal one", async () => {
    const venmo = structuredClone(ENGINE) as any;
    venmo["/api/payouts"].batches[0].items[0].wallet = "VENMO";
    venmo["/api/payouts"].batches[0].items[0].receiver = "Venmo ···0123";
    const html = await (await appWith(RUNS, venmo).request("/payout")).text();
    expect(html).toContain("through PayPal Payouts, to Venmo.");
    expect(html).toContain("paid to Venmo");
    expect(html).toContain("Venmo ···0123");
    expect(html).toContain("Sent with PayPal Payouts to Venmo.");
    const paypal = await (await appWith(RUNS).request("/payout")).text();
    expect(paypal).not.toContain("Venmo");
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

describe("brand statement (PayPal Invoicing)", () => {
  const STATEMENT = {
    id: "stmt-1",
    brandId: "winix",
    invoiceNumber: "CITED-WINIX-A8DC4A8F",
    invoiceId: "INV2-AAAA-BBBB-CCCC-DDDD",
    status: "MARKED_AS_PAID",
    currency: "USD",
    creditedMinor: 39_164,
    voidedMinor: 768,
    paidMinor: 38_396,
    returnedMinor: 61_604,
    depositedMinor: 100_000,
    reservedMinor: 0,
    invoiceTotalMinor: 38_396,
    invoicePaidMinor: 38_396,
    invoiceDueMinor: 0,
    lines: [
      {
        creatorId: "housefresh",
        name: "HouseFresh",
        creditedMinor: 39_164,
        voidedMinor: 768,
        paidMinor: 38_396,
        credits: 51,
      },
    ],
    payoutBatchIds: ["PAYOUT-BATCH-77"],
    refundIds: ["REFUND-1"],
    createdAt: "2026-12-02T00:00:00.000Z",
  };
  const withStatement = () => {
    const e = structuredClone(ENGINE) as any;
    e["/api/invoices"] = { statements: [STATEMENT] };
    return e;
  };

  it("links the payout to the brand statement that covers its batch", async () => {
    const html = await (await appWith(RUNS, withStatement()).request("/payout")).text();
    expect(html).toContain('href="/statement?brand=winix"');
    expect(html).toContain("CITED-WINIX-A8DC4A8F");
    expect(html).toContain("marked paid, $0 due");
    // The clean video frame stays as it was.
    const clean = await (await appWith(RUNS, withStatement()).request("/payout?clean=1")).text();
    expect(clean).not.toContain("/statement?brand=");
  });

  it("shows no link when the engine has no statements endpoint", async () => {
    const html = await (await appWith(RUNS).request("/payout")).text();
    expect(html).toContain("$391.64");
    expect(html).not.toContain("/statement?brand=");
  });

  it("renders the statement: lines, voids, paid, returned, $0 due", async () => {
    const html = await (
      await appWith(RUNS, withStatement()).request("/statement?brand=winix")
    ).text();
    expect(html).toContain("Winix · CITED programme statement");
    expect(html).toContain("INV2-AAAA-BBBB-CCCC-DDDD");
    expect(html).toContain("$391.64");
    expect(html).toContain("−$7.68");
    expect(html).toContain("$383.96");
    expect(html).toContain("$616.04");
    expect(html).toContain("$0.00 due");
    expect(html).not.toContain("differs from the");
  });

  it("waits when there is no statement yet, and answers 503 when the engine is down", async () => {
    const empty = structuredClone(ENGINE) as any;
    empty["/api/invoices"] = { statements: [] };
    const html = await (await appWith(RUNS, empty).request("/statement")).text();
    expect(html).toContain("No statement yet");
    expect((await appWith(RUNS, "down").request("/statement")).status).toBe(503);
  });
});

describe("a programme in pounds", () => {
  const GBP = structuredClone(ENGINE) as any;
  GBP["/api/payouts"].batches[0].items[0].currency = "GBP";
  GBP["/api/payouts"].batches[0].items[0].amountMinor = 39_164;
  GBP["/api/credits"].creators[0].credits[0].currency = "GBP";
  GBP["/api/invoices"] = {
    statements: [
      {
        id: "stmt-g",
        brandId: "winix",
        invoiceNumber: "CITED-WINIX-GBP00001",
        invoiceId: "INV2-GBP",
        status: "MARKED_AS_PAID",
        currency: "GBP",
        creditedMinor: 39_164,
        voidedMinor: 768,
        paidMinor: 38_396,
        returnedMinor: 61_604,
        depositedMinor: 100_000,
        reservedMinor: 0,
        invoiceTotalMinor: 38_396,
        invoicePaidMinor: 38_396,
        invoiceDueMinor: 0,
        lines: [
          {
            creatorId: "housefresh",
            name: "HouseFresh",
            creditedMinor: 39_164,
            voidedMinor: 768,
            paidMinor: 38_396,
            credits: 51,
          },
        ],
        payoutBatchIds: ["PAYOUT-BATCH-77"],
        refundIds: ["REFUND-1"],
        createdAt: "2026-12-02T00:00:00.000Z",
      },
    ],
  };

  it("shows the payout in pounds, with the pound symbol and no dollars", async () => {
    const html = await (await appWith(RUNS, GBP).request("/payout")).text();
    expect(html).toContain("£391.64");
    expect(html).toContain("<small>GBP</small>");
    expect(html).toContain("marked paid, £0 due");
    expect(html).toContain("£0.00 paid · no lift");
    expect(html).not.toContain("$391.64");
    expect(html).not.toContain("differs from this payout");
    // The sandbox note is for the dollar payout the sandbox actually ran.
    expect(html).not.toContain("real PayPal sandbox");
    // The item id names its currency, the way the engine does when it has no PayPal id.
    const noId = structuredClone(GBP);
    noId["/api/payouts"].batches[0].items[0].payoutItemId = undefined;
    expect(await (await appWith(RUNS, noId).request("/payout")).text()).toContain(
      "housefresh-abcdef01-GBP",
    );
  });

  it("shows the statement in pounds, line by line", async () => {
    const html = await (await appWith(RUNS, GBP).request("/statement?brand=winix")).text();
    expect(html).toContain("£391.64");
    expect(html).toContain("−£7.68");
    expect(html).toContain("£383.96");
    expect(html).toContain("£616.04");
    expect(html).toContain("£0.00 due");
    expect(html).not.toMatch(/\$\d/);
  });

  it("formats euros too", async () => {
    const eur = structuredClone(GBP);
    eur["/api/payouts"].batches[0].items[0].currency = "EUR";
    const html = await (await appWith(RUNS, eur).request("/payout")).text();
    expect(html).toContain("€391.64");
  });
});
