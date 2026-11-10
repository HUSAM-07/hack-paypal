import { describe, expect, it } from "vitest";
import { call, e } from "./helpers";

const A = { upc: "100000000001", brand: "Winix", name: "A230" };
const B = { upc: "100000000002", brand: "Levoit", name: "Core 300" };
const disclosure = "I may earn a commission from CITED when an agent buys after reading this.";

function input(creatorId: string, over: Record<string, unknown> = {}) {
  return {
    creator: { creatorId, name: "Quiet Rooms", paypalId: "SIMPAYER23456" },
    test: {
      id: `${creatorId}-t1`,
      kind: "test",
      creatorId,
      category: "air-purifier",
      skus: [A, B],
      verdictUpc: A.upc,
      summary: "Same room, same smoke load; the A230 cleared it faster.",
      disclosure,
    },
    placebo: {
      id: `${creatorId}-p1`,
      kind: "placebo",
      creatorId,
      category: "desk-lamp",
      skus: [],
      summary: "A review of three desk lamps.",
      disclosure,
    },
    ...over,
  };
}

describe("POST /tests", () => {
  it("stores the creator (tagged onboarding, PAYPAL_ID payee) and both pieces of content", async () => {
    const r = await call("POST", "/tests", input("c-abc123"));
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ ok: true, testId: "c-abc123-t1", placeboId: "c-abc123-p1" });
    const row = await e.DB.prepare("SELECT * FROM creators WHERE creator_id = 'c-abc123'").first();
    expect(row).toMatchObject({
      name: "Quiet Rooms",
      paypal_id: "SIMPAYER23456",
      source: "onboarding",
    });
    const list = await call<{ tests: { test: { id: string }; pairsWith: string | null }[] }>(
      "GET",
      "/tests?creatorId=c-abc123",
    );
    expect(list.json.tests.map((t) => [t.test.id, t.pairsWith]).sort()).toEqual([
      ["c-abc123-p1", "c-abc123-t1"],
      ["c-abc123-t1", null],
    ]);
  });

  it("never overwrites a demo creator", async () => {
    await call("POST", "/creators", {
      creatorId: "housefresh",
      name: "HouseFresh",
      paypalId: "HF",
    });
    const r = await call("POST", "/tests", input("housefresh"));
    expect(r.status).toBe(409);
    const row = await e.DB.prepare(
      "SELECT * FROM creators WHERE creator_id = 'housefresh'",
    ).first();
    expect(row).toMatchObject({ name: "HouseFresh", paypal_id: "HF", source: "demo" });
  });

  it("rejects a verdict outside the tested SKUs, a one-SKU test and a mismatched creator", async () => {
    const base = input("c-bad");
    for (const bad of [
      { test: { ...base.test, verdictUpc: "100000000009" } },
      { test: { ...base.test, skus: [A], verdictUpc: undefined } },
      { placebo: { ...base.placebo, creatorId: "someone" } },
      { placebo: { ...base.placebo, kind: "test" } },
      { test: { ...base.test, disclosure: "" } },
    ]) {
      expect((await call("POST", "/tests", input("c-bad", bad))).status).toBe(400);
    }
  });

  it("accepts a close call (no verdict)", async () => {
    const base = input("c-close");
    const r = await call(
      "POST",
      "/tests",
      input("c-close", { test: { ...base.test, verdictUpc: undefined } }),
    );
    expect(r.status).toBe(201);
  });
});
