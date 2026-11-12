import { type Arm, DEFAULT_SCHEDULE, verifyPassport } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { assignArm } from "../src/arms";
import { createCatalogue, DEFAULT_PUBLISHED_AT } from "../src/catalogue";
import { DemoClock, testDay } from "../src/clock";

const KEY = "test-key";
// Pin the clock to day 0: the real date moves the arm schedule and breaks sessionFor().
const make = (seed = "seed") =>
  createCatalogue({
    seed,
    passportKey: KEY,
    clock: new DemoClock(() => DEFAULT_PUBLISHED_AT.getTime()),
  });

/** Find a session id that lands in the wanted arm on day 0. */
function sessionFor(arm: Arm, seed = "seed", day = 0): string {
  for (let i = 0; i < 10_000; i++) {
    if (assignArm(seed, `x${i}`, day, DEFAULT_SCHEDULE) === arm) return `x${i}`;
  }
  throw new Error("no session found");
}

describe("arm assignment", () => {
  it("is reproducible from a seed", () => {
    const a = Array.from({ length: 200 }, (_, i) => assignArm("s", `id${i}`, 0, DEFAULT_SCHEDULE));
    const b = Array.from({ length: 200 }, (_, i) => assignArm("s", `id${i}`, 0, DEFAULT_SCHEDULE));
    expect(a).toEqual(b);
    const c = Array.from({ length: 200 }, (_, i) =>
      assignArm("other", `id${i}`, 0, DEFAULT_SCHEDULE),
    );
    expect(c).not.toEqual(a);
  });

  const share = (day: number) => {
    const n = 20_000;
    const counts: Record<Arm, number> = { test: 0, placebo: 0, none: 0 };
    for (let i = 0; i < n; i++) counts[assignArm("seed", `u${i}`, day, DEFAULT_SCHEDULE)]++;
    return { test: counts.test / n, placebo: counts.placebo / n, none: counts.none / n };
  };

  it("calibration phase (days 0-6) is 50/25/25", () => {
    for (const day of [0, 6]) {
      const s = share(day);
      expect(s.test).toBeCloseTo(0.5, 1);
      expect(s.placebo).toBeCloseTo(0.25, 1);
      expect(s.none).toBeCloseTo(0.25, 1);
    }
  });

  it("steady phase (day 7 on) holds out 5%", () => {
    for (const day of [7, 30]) {
      const s = share(day);
      expect(s.test).toBeCloseTo(0.95, 1);
      expect(s.placebo + s.none).toBeCloseTo(0.05, 1);
    }
  });
});

describe("demo clock", () => {
  it("switches schedule at day 7 when advanced", () => {
    const clock = new DemoClock(() => DEFAULT_PUBLISHED_AT.getTime());
    expect(testDay(DEFAULT_PUBLISHED_AT, clock.now())).toBe(0);
    clock.advanceDays(6);
    expect(testDay(DEFAULT_PUBLISHED_AT, clock.now())).toBe(6);
    clock.advanceDays(1);
    expect(testDay(DEFAULT_PUBLISHED_AT, clock.now())).toBe(7);
  });
});

describe("search_product", () => {
  it("offers both purifiers from all three sellers, price-matched, Lumen $4 under Northwind", async () => {
    const { offers } = await make().search({ query: "air purifier" });
    expect(new Set(offers.map((o) => o.seller.id))).toEqual(
      new Set(["northwind", "lumen", "megamart"]),
    );
    const price = (seller: string, brand: string) =>
      offers.find((o) => o.seller.id === seller && o.brand === brand)?.price;
    expect(price("northwind", "Winix")).toEqual({ amountMinor: 9999, currency: "USD" });
    expect(price("lumen", "Winix")).toEqual({ amountMinor: 9599, currency: "USD" });
    expect(price("lumen", "Levoit")).toEqual(price("lumen", "Winix"));
    expect(price("megamart", "Levoit")).toEqual({ amountMinor: 10299, currency: "USD" });
    const lumen = offers.find((o) => o.seller.id === "lumen");
    expect(lumen?.seller.payee.merchant_id).toBeTruthy();
    expect(new Set(offers.map((o) => o.offerId)).size).toBe(offers.length);
  });

  it("attaches content per arm", async () => {
    const cat = make();
    const run = async (arm: Arm, coExposed = false) => {
      const body = cat.newSession(sessionFor(arm), coExposed);
      const { signPassport } = await import("@pact/protocol");
      return cat.search({ query: "air purifier", passport: await signPassport(body, KEY) });
    };
    expect((await run("test")).creatorContent.map((t) => t.id)).toEqual([
      "hf-winix-a230-vs-levoit-core300",
    ]);
    expect((await run("test", true)).creatorContent.map((t) => t.creatorId)).toEqual([
      "housefresh",
      "airlab",
    ]);
    expect((await run("placebo")).creatorContent.map((t) => t.kind)).toEqual(["placebo"]);
    expect((await run("none")).creatorContent).toEqual([]);
  });

  it("ranking is byte-identical across arms", async () => {
    const cat = make();
    const { signPassport } = await import("@pact/protocol");
    const orders: string[] = [];
    for (const arm of ["test", "placebo", "none"] as const) {
      const body = cat.newSession(sessionFor(arm), true);
      expect(body.arm).toBe(arm);
      const r = await cat.search({
        query: "air purifier",
        passport: await signPassport(body, KEY),
      });
      orders.push(JSON.stringify(r.offers));
    }
    expect(orders[0]).toBe(orders[1]);
    expect(orders[1]).toBe(orders[2]);
  });

  it("issues a verifiable passport, keeps the arm and records sellers viewed", async () => {
    const cat = make();
    const unknown = await verifyPassport(
      (await cat.search({ query: "winix", sellerId: "nope" })).passport,
      KEY,
    );
    expect(unknown.ok && unknown.body.storesViewed).toEqual([]);
    const first = await cat.search({ query: "winix", sellerId: "northwind" });
    const v1 = await verifyPassport(first.passport, KEY);
    expect(v1.ok && v1.body.storesViewed).toEqual(["northwind"]);
    const second = await cat.search({
      query: "winix",
      passport: first.passport,
      sellerId: "lumen",
    });
    const v2 = await verifyPassport(second.passport, KEY);
    expect(v2.ok && v2.body.arm).toBe(v1.ok && v1.body.arm);
    expect(v2.ok && v2.body.sessionId).toBe(v1.ok && v1.body.sessionId);
    expect(v2.ok && v2.body.storesViewed).toEqual(["northwind", "lumen"]);
  });

  it("starts a fresh session when the passport is forged", async () => {
    const cat = make();
    const { passport } = await cat.search({
      query: "winix",
      passport: "v1|abc|test||.AAAAAAAAAAAAAAAA",
    });
    expect((await verifyPassport(passport, KEY)).ok).toBe(true);
  });
});

describe("robot vacuums, the second category", () => {
  const run = async (arm: Arm, query = "robot vacuum") => {
    const cat = make();
    const { signPassport } = await import("@pact/protocol");
    const body = cat.newSession(sessionFor(arm), false, "robot-vacuum");
    return {
      cat,
      body,
      res: await cat.search({ query, passport: await signPassport(body, KEY) }),
    };
  };

  it("offers both vacuums from all three sellers, price-matched, Lumen $4 under Northwind", async () => {
    const { offers } = await make().search({ query: "robot vacuum" });
    expect(offers).toHaveLength(6);
    expect(new Set(offers.map((o) => o.brand))).toEqual(new Set(["Roborock", "iRobot"]));
    const price = (seller: string, brand: string) =>
      offers.find((o) => o.seller.id === seller && o.brand === brand)?.price.amountMinor;
    expect(price("northwind", "Roborock")).toBe(29999);
    expect(price("lumen", "Roborock")).toBe(29599);
    expect(price("lumen", "iRobot")).toBe(price("lumen", "Roborock"));
    expect(price("megamart", "iRobot")).toBe(30299);
    expect(new Set(offers.map((o) => o.offerId)).size).toBe(6);
  });

  it("a search is answered from one category: purifier results are unchanged, vacuums never leak in", async () => {
    const cat = make();
    for (const q of ["air purifier", "small bedroom air purifier", "winix", "purifier"]) {
      const { offers } = await cat.search({ query: q });
      expect(offers.length).toBeGreaterThan(0);
      expect(offers.every((o) => ["Winix", "Levoit"].includes(o.brand))).toBe(true);
    }
    const { offers } = await cat.search({ query: "air purifier" });
    expect(offers.map((o) => o.offerId)).toEqual([
      "lumen-100000000001",
      "lumen-100000000002",
      "northwind-100000000001",
      "northwind-100000000002",
      "megamart-100000000001",
      "megamart-100000000002",
    ]);
    for (const q of ["robot vacuum cleaner", "roomba", "Roborock", "mop"]) {
      const r = await cat.search({ query: q });
      expect(r.offers.length).toBeGreaterThan(0);
      expect(r.offers.every((o) => ["Roborock", "iRobot"].includes(o.brand))).toBe(true);
    }
  });

  it("attaches the creator's content per arm: test, placebo, nothing", async () => {
    expect((await run("test")).res.creatorContent.map((t) => t.id)).toEqual([
      "cl-roborock-q7max-vs-roomba-j5",
    ]);
    expect((await run("placebo")).res.creatorContent.map((t) => t.kind)).toEqual(["placebo"]);
    expect((await run("none")).res.creatorContent).toEqual([]);
  });

  it("ranking is byte-identical across arms", async () => {
    const orders: string[] = [];
    for (const arm of ["test", "placebo", "none"] as const) {
      const { body, res } = await run(arm);
      expect(body.arm).toBe(arm);
      orders.push(JSON.stringify(res.offers));
    }
    expect(orders[0]).toBe(orders[1]);
    expect(orders[1]).toBe(orders[2]);
  });

  it("the passport names the vacuum creator, so its test can be credited", async () => {
    for (const arm of ["test", "placebo"] as const) {
      const { body } = await run(arm);
      expect(body.creatorsSeen).toEqual(["crumblab"]);
    }
    expect((await run("none")).body.creatorsSeen).toEqual([]);
  });

  it("a session that starts with purifiers and then asks for vacuums keeps its arm and adds the vacuum creator", async () => {
    const cat = make();
    const { signPassport } = await import("@pact/protocol");
    const body = cat.newSession(sessionFor("test"), false);
    expect(body.creatorsSeen).toEqual(["housefresh"]);
    const out = await cat.search({
      query: "robot vacuum",
      passport: await signPassport(body, KEY),
    });
    const v = await verifyPassport(out.passport, KEY);
    expect(v.ok && v.body.arm).toBe("test");
    expect(v.ok && v.body.creatorsSeen).toEqual(["housefresh", "crumblab"]);
    expect(out.creatorContent.map((t) => t.creatorId)).toEqual(["crumblab"]);
    // Back to purifiers: same passport body, nothing added.
    const back = await cat.search({ query: "air purifier", passport: out.passport });
    const v2 = await verifyPassport(back.passport, KEY);
    expect(v2.ok && v2.body.creatorsSeen).toEqual(["housefresh", "crumblab"]);
    expect(back.creatorContent.map((t) => t.creatorId)).toEqual(["housefresh"]);
  });
});

describe("demo session ids", () => {
  it("honours a caller-chosen session id only when allowed", async () => {
    const open = createCatalogue({ seed: "s", passportKey: "k", allowSessionId: true });
    const shut = createCatalogue({ seed: "s", passportKey: "k" });
    const a = await open.search({ query: "air purifier", sessionId: "demo-1" });
    const b = await open.search({ query: "air purifier", sessionId: "demo-1" });
    expect(a.passport.split("|")[1]).toBe("demo-1");
    expect(a.passport).toBe(b.passport); // same id, same arm, same passport
    const c = await shut.search({ query: "air purifier", sessionId: "demo-1" });
    expect(c.passport.split("|")[1]).not.toBe("demo-1");
  });
});
