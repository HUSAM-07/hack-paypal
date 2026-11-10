import { describe, expect, it } from "vitest";
import {
  analyse,
  chartAgent,
  createEngineApprover,
  createStudioApp,
  dataAgent,
  onlyKnownFigures,
  type RawEngine,
  recommendAmount,
} from "../src/index";

/** The locked demo: 51 caused units, $391.64 credited, $7.68 voided, $383.96 paid, $616.04 returned. */
function demoEngine(topUp = 0): RawEngine {
  const credit = (id: string, amountMinor: number, state: string) => ({
    id,
    captureId: id,
    brandId: "winix",
    upc: "W",
    amountMinor,
    currency: "USD",
    state,
    voidReason: state === "voided" ? "refund" : null,
    holdUntil: null,
    payoutBatchId: state === "paid" ? "B1" : null,
    payoutStatus: state === "paid" ? "SUCCESS" : null,
  });
  return {
    now: "2026-12-09T00:00:00Z",
    lift: [
      {
        brandId: "winix",
        name: "Winix",
        category: "purifier",
        upc: "W",
        arms: {
          test: { sessions: 100, purchases: 70 },
          placebo: { sessions: 100, purchases: 20 },
          none: { sessions: 50, purchases: 5 },
        },
        lift: 0.5,
        lowerBound: 0.4,
        attributableFraction: 0.8,
        exposedSales: 90,
        causedUnits: 51,
      },
    ],
    deposits: [
      {
        brandId: "winix",
        name: "Winix",
        currency: "USD",
        deposited: 100000 + topUp,
        reserved: 0,
        spent: 38396,
        returned: 61604,
        available: topUp,
        deposits: [
          { id: "i", kind: "initial", amountMinor: 100000, returnedMinor: 61604 },
          ...(topUp ? [{ id: "t", kind: "topup", amountMinor: topUp, returnedMinor: 0 }] : []),
        ],
      },
    ],
    creators: [
      {
        creatorId: "housefresh",
        name: "HouseFresh",
        totals: { pending: 0, voided: 768, paid: 38396 },
        credits: [credit("C1", 38396, "paid"), credit("C2", 768, "voided")],
      },
    ],
    journeys: [],
  };
}

describe("Analyst numbers", () => {
  it("computes the facts from the engine read API", () => {
    const f = dataAgent(demoEngine());
    expect(f).toMatchObject({
      causedUnits: 51,
      creditedMinor: 39164,
      voidedMinor: 768,
      paidMinor: 38396,
      returnedMinor: 61604,
      availableMinor: 0,
      topUpsMinor: 0,
    });
  });

  it("recommends the $500 top-up when lift is proven and the deposit cannot fund another cycle", async () => {
    const rec = await analyse(demoEngine());
    expect(rec).toMatchObject({
      action: "raise_cap",
      amountMinor: 50_000,
      approvalId: "analyst-1",
      brandId: "winix",
      wording: "template",
    });
    expect(rec?.headline).toBe("Raise Winix's programme cap by $500.00");
    const cited = Object.fromEntries((rec?.citations ?? []).map((c) => [c.label, c.value]));
    expect(cited["Sales the test caused"]).toBe("51 of 90 exposed");
    expect(cited["Credited this cycle"]).toBe("$391.64");
    expect(cited["Voided by refunds"]).toBe("$7.68");
    expect(cited["Deposit left"]).toBe("$0.00");
    expect(cited["Unspent deposit returned"]).toBe("$616.04");
    expect(rec?.rationale).toContain("$391.64");
    expect(rec?.guard).toMatch(/never changes ranking or a verdict/);
    expect(rec?.chart.highlight).toBe("available");
  });

  it("rounds the shortfall up to $500 steps", () => {
    const f = dataAgent(demoEngine());
    if (!f) throw new Error("no facts");
    expect(recommendAmount({ ...f, creditedMinor: 120_000 })).toBe(150_000);
    expect(recommendAmount({ ...f, creditedMinor: 50_000, availableMinor: 0 })).toBe(50_000);
  });

  it("recommends nothing without proven lift, and nothing once the deposit covers a cycle", async () => {
    const f = dataAgent(demoEngine());
    if (!f) throw new Error("no facts");
    expect(recommendAmount({ ...f, lowerBound: -0.1 })).toBeNull();
    expect(recommendAmount({ ...f, lowerBound: null })).toBeNull();
    expect(recommendAmount({ ...f, causedUnits: 0 })).toBeNull();
    const after = await analyse(demoEngine(50_000));
    expect(after).toMatchObject({ action: "none", amountMinor: null });
    expect(after?.headline).toBe("Top-up of $500.00 approved");
  });

  it("the chart agent highlights the deposit left against one cycle's credits", () => {
    const f = dataAgent(demoEngine());
    if (!f) throw new Error("no facts");
    expect(chartAgent(f).bars).toEqual([
      { key: "cycle", label: "Credited this cycle", minor: 39164 },
      { key: "available", label: "Left to fund the next cycle", minor: 0 },
    ]);
  });
});

describe("Analyst wording", () => {
  it("uses the model's wording when it cites only supplied figures", async () => {
    const rec = await analyse(demoEngine(), {
      wording: async () => ({
        text: "Winix's test caused 51 of 90 exposed sales. Raise the cap by $500.00 to fund the next cycle.",
        model: "anthropic:test",
      }),
    });
    expect(rec?.wording).toBe("anthropic:test");
    expect(rec?.rationale).toContain("fund the next cycle");
  });

  it("falls back to the template when the model invents a number, fails, or returns nothing", async () => {
    const template = (await analyse(demoEngine()))?.rationale;
    for (const wording of [
      async () => ({ text: "Raise the cap by $900.00 now.", model: "m" }),
      async () => {
        throw new Error("down");
      },
      async () => null,
      async () => ({ text: "  ", model: "m" }),
    ]) {
      const rec = await analyse(demoEngine(), { wording });
      expect(rec?.wording).toBe("template");
      expect(rec?.rationale).toBe(template);
    }
  });

  it("checks figures regardless of thousands separators", () => {
    expect(onlyKnownFigures("$1,000.00 and 51", ["1000.00", "51"])).toBe(true);
    expect(onlyKnownFigures("$1,001.00", ["1000.00"])).toBe(false);
  });
});

type Dash = { brands: { deposit: Record<string, number> }[] };

describe("Approval", () => {
  /** A fake engine: approving captures the top-up, so the next read shows it. */
  function fake() {
    let topUp = 0;
    const calls: unknown[] = [];
    const app = createStudioApp({
      read: async () => demoEngine(topUp),
      approve: async (a) => {
        calls.push(a);
        topUp = a.amountMinor;
        return { status: "captured" };
      },
    });
    return { app, calls };
  }
  const approve = (app: ReturnType<typeof fake>["app"], headers: Record<string, string> = {}) =>
    app.request("/api/analyst/approve", { method: "POST", headers });

  it("Maya's approval captures the recommended top-up and the deposit view reflects it", async () => {
    const { app, calls } = fake();
    const before = (await (await app.request("/api/dashboard")).json()) as Dash;
    expect(before.brands[0]?.deposit).toMatchObject({ topUps: 0, available: 0 });

    const res = await approve(app, { "x-studio": "approve" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ approved: true, amountMinor: 50_000 });
    expect(calls).toEqual([{ approvalId: "analyst-1", brandId: "winix", amountMinor: 50_000 }]);

    const after = (await (await app.request("/api/dashboard")).json()) as Dash;
    expect(after.brands[0]?.deposit).toMatchObject({ topUps: 50_000, available: 50_000 });
    const rec = (await (await app.request("/api/analyst")).json()) as { action: string };
    expect(rec.action).toBe("none");
  });

  it("refuses a request without the studio header, and when nothing needs approving", async () => {
    const { app, calls } = fake();
    expect((await approve(app)).status).toBe(403);
    expect(calls).toEqual([]);
    await approve(app, { "x-studio": "approve" });
    expect((await approve(app, { "x-studio": "approve" })).status).toBe(409);
    expect(calls).toHaveLength(1);
  });

  it("takes the amount from the recommendation, never from the request", async () => {
    const { app, calls } = fake();
    await app.request("/api/analyst/approve", {
      method: "POST",
      headers: { "x-studio": "approve", "content-type": "application/json" },
      body: JSON.stringify({ amountMinor: 9_999_999, brandId: "levoit" }),
    });
    expect(calls).toEqual([{ approvalId: "analyst-1", brandId: "winix", amountMinor: 50_000 }]);
  });

  it("the engine approver posts the approval endpoint's body", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const approve = createEngineApprover({
      baseUrl: "http://engine/",
      token: "t",
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push({ url, init });
        return Response.json({ status: "captured" }, { status: 201 });
      }) as unknown as typeof fetch,
    });
    await approve({ approvalId: "analyst-1", brandId: "winix", amountMinor: 50_000 });
    expect(seen[0]?.url).toBe("http://engine/api/approvals/analyst-1/approve");
    expect(seen[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      brandId: "winix",
      amountMinor: 50_000,
    });
  });

  it("serves the Analyst panel in the brand page only", async () => {
    const { app } = fake();
    expect(await (await app.request("/")).text()).toContain('id="analyst"');
    expect(await (await app.request("/creator")).text()).not.toContain('id="analyst"');
  });
});
