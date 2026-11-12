import { commissionWhatIf, type WhatIfBrand } from "@pact/attribution";
import { describe, expect, it } from "vitest";
import { call, seedExperiment, WINIX } from "./helpers";

type Credits = { creators: { credits: { id: string; amountMinor: number }[] }[] };

describe("GET /what-if: the inputs of the Studio commission what-if", () => {
  it("re-running the ledger's maths on them at 8% reproduces every credit the engine made", async () => {
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

    const res = await call<{ brands: WhatIfBrand[]; truncated: boolean }>("GET", "/what-if");
    expect(res.status).toBe(200);
    expect(res.json.truncated).toBe(false);
    const winix = res.json.brands.find((b) => b.brandId === "winix") as WhatIfBrand;
    expect(winix.causedUnits).toBe(51);
    expect(winix.sales).toHaveLength(57);
    expect(winix.selfDealtSales).toEqual([]);
    expect(winix.coalitions).toEqual({ housefresh: expect.any(Number) });

    const ledger = (await call<Credits>("GET", "/credits")).json.creators.flatMap((c) => c.credits);
    const mine = commissionWhatIf(winix, { commissionBps: 800, depositMinor: 100_000 });
    expect(mine.causedUnits).toBe(51);
    expect(mine.credited.amountMinor).toBe(39_164);
    expect(mine.credits.map((c) => [c.id, c.amount.amountMinor]).sort()).toEqual(
      ledger.map((c) => [c.id, c.amountMinor]).sort(),
    );
  });

  it("is a read: asking for it changes nothing on the ledger", async () => {
    const before = (await call<Credits>("GET", "/credits")).json;
    await call("GET", "/what-if");
    expect((await call<Credits>("GET", "/credits")).json).toEqual(before);
  });
});
