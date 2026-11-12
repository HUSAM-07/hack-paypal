import { describe, expect, it, vi } from "vitest";
import { getPayPal } from "../src/paypal";
import { call, e, seedExperiment, WINIX } from "./helpers";

type Programme = {
  brand: { brandId: string; category: string; upc: string; commissionBps: number };
  deposit: {
    status: string;
    amountMinor: number;
    captureId: string | null;
    kind: string;
    orderId: string;
  };
};
type Deposits = {
  brands: { brandId: string; deposited: number; available: number; deposits: unknown[] }[];
};
type Credits = { creators: { credits: { id: string; amountMinor: number }[] }[] };
type Lift = {
  brands: {
    brandId: string;
    commissionBps: number;
    exposedSales: number;
    causedUnits: number;
  }[];
};

const ROBOROCK = "100000000006";
const IROBOT = "100000000007";
const LEVOIT_PURIFIER = "100000000002";
const start = (over: Record<string, unknown> = {}) =>
  call<Programme & { error?: string; message?: string }>("POST", "/programmes", {
    category: "robot-vacuum",
    upc: ROBOROCK,
    depositMinor: 50_000,
    commissionBps: 1_200,
    ...over,
  });

describe("POST /programmes: a brand starts a programme", () => {
  it("creates the programme and captures its deposit through one Orders v2 CAPTURE order", async () => {
    const create = vi.spyOn(getPayPal(e).paypal.orders, "create");
    const res = await start();
    expect(res.status).toBe(201);
    expect(res.json.brand).toMatchObject({
      brandId: "roborock",
      category: "robot-vacuum",
      upc: ROBOROCK,
      commissionBps: 1_200,
    });
    expect(res.json.deposit).toMatchObject({
      status: "captured",
      kind: "initial",
      amountMinor: 50_000,
    });
    expect(res.json.deposit.captureId).toBeTruthy();

    // Request shape: an intent=CAPTURE order for exactly the deposit, tagged to the programme,
    // with a deterministic PayPal-Request-Id (no clock, no random part).
    expect(create).toHaveBeenCalledTimes(1);
    const [order, opts] = create.mock.calls[0] as [
      {
        intent: string;
        purchase_units: { amount: unknown; custom_id: string; reference_id: string }[];
      },
      { requestId: string },
    ];
    expect(order.intent).toBe("CAPTURE");
    expect(order.purchase_units).toHaveLength(1);
    expect(order.purchase_units[0]).toMatchObject({
      amount: { amountMinor: 50_000, currency: "USD" },
      custom_id: "cited-dep:roborock",
      reference_id: "cited-dep-roborock",
    });
    expect(opts.requestId).toBe("cited-dep:roborock:initial");
    create.mockRestore();
  });

  it("charges once: confirming again is refused and adds no second deposit", async () => {
    const again = await start();
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("programme_exists");
    const dep = (await call<Deposits>("GET", "/deposits")).json.brands.find(
      (b) => b.brandId === "roborock",
    );
    expect(dep?.deposited).toBe(50_000);
    expect(dep?.deposits).toHaveLength(1);
  });

  it("lists the new programme, empty, with its own rate", async () => {
    const lift = (await call<Lift>("GET", "/lift")).json.brands;
    const mine = lift.find((b) => b.brandId === "roborock");
    expect(mine).toMatchObject({ commissionBps: 1_200, exposedSales: 0, causedUnits: 0 });
  });

  it("refuses bad terms before anything reaches PayPal", async () => {
    const create = vi.spyOn(getPayPal(e).paypal.orders, "create");
    for (const bad of [
      { category: "humidifier" },
      { upc: WINIX },
      { upc: IROBOT, depositMinor: 99 },
      { upc: IROBOT, depositMinor: 12.5 },
      { upc: IROBOT, commissionBps: 5_000 },
      { upc: IROBOT, commissionBps: 80.5 },
    ]) {
      const r = await start(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
    expect(
      (await call<{ brands: { brandId: string }[] }>("GET", "/brands")).json.brands.some(
        (b) => b.brandId === "irobot",
      ),
    ).toBe(false);
    create.mockRestore();
  });
});

describe("writes stay locked without the token", () => {
  it("answers 503 with no token configured, and 401 with a wrong one", async () => {
    const { app } = await import("../src/index");
    const body = JSON.stringify({
      category: "robot-vacuum",
      upc: IROBOT,
      depositMinor: 50_000,
      commissionBps: 800,
    });
    const locked = { ...e, ENGINE_OPEN_API: undefined } as unknown as typeof e;
    const none = await app.request("/api/programmes", { method: "POST", body }, locked);
    expect(none.status).toBe(503);
    const wrong = await app.request(
      "/api/programmes",
      { method: "POST", body, headers: { authorization: "Bearer nope" } },
      { ...locked, ENGINE_API_TOKEN: "right" } as unknown as typeof e,
    );
    expect(wrong.status).toBe(401);
    const right = await app.request(
      "/api/programmes",
      { method: "POST", body, headers: { authorization: "Bearer right" } },
      { ...locked, ENGINE_API_TOKEN: "right" } as unknown as typeof e,
    );
    expect(right.status).toBe(201);
  });
});

describe("a new programme does not touch the programme that runs", () => {
  it("leaves the purifier programme's lift, credits and deposit exactly as they were", async () => {
    await call("POST", "/brands", {
      brandId: "winix",
      name: "Winix",
      category: "purifier",
      upc: WINIX,
    });
    await call("POST", "/creators", {
      creatorId: "housefresh",
      name: "HouseFresh",
      paypalId: "HOUSEFRESH-PP",
    });
    await call("POST", "/brands/winix/deposits", { amountMinor: 100_000 });
    await seedExperiment();
    await call("POST", "/credits/recompute");

    const snap = async () => ({
      credits: (await call<Credits>("GET", "/credits")).json.creators,
      winix: (await call<Lift["brands"][number]>("GET", "/lift/winix")).json,
      deposit: (await call<Deposits>("GET", "/deposits")).json.brands.find(
        (b) => b.brandId === "winix",
      ),
    });
    const before = await snap();
    expect(before.winix.causedUnits).toBe(51);
    expect(before.winix.commissionBps).toBe(800);

    // Another programme, in the other category, funded and recomputed.
    const other = await start({
      category: "purifier",
      upc: LEVOIT_PURIFIER,
      depositMinor: 25_000,
      commissionBps: 500,
    });
    expect(other.status).toBe(201);
    await call("POST", "/credits/recompute");

    expect(await snap()).toEqual(before);
    // Winix's 51 units are still the only credits: $391.64 at the 8% it started on.
    const all = (await snap()).credits.flatMap((c) => c.credits);
    expect(all).toHaveLength(51);
    expect(all.reduce((a, c) => a + c.amountMinor, 0)).toBe(39_164);
  });

  it("will not start a second programme on a product that already has one", async () => {
    const dup = await start({ category: "purifier", upc: LEVOIT_PURIFIER });
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe("programme_exists");
  });
});
