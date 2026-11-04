import { describe, expect, it } from "vitest";
import { getPayPal } from "../src/paypal";
import { call, e, LEVOIT, PRICE, seedExperiment, WINIX } from "./helpers";

type Json = Record<string, any>;

describe("CITED demo money flow (simulated PayPal)", () => {
  it("funds both brands, credits 102 Winix units, pays HouseFresh and returns the rest", async () => {
    await call("POST", "/brands", {
      brandId: "winix",
      name: "Winix",
      category: "purifier",
      upc: WINIX,
    });
    await call("POST", "/brands", {
      brandId: "levoit",
      name: "Levoit",
      category: "purifier",
      upc: LEVOIT,
    });
    await call("POST", "/creators", {
      creatorId: "housefresh",
      name: "HouseFresh",
      paypalId: "HOUSEFRESH-PP",
    });
    await call("POST", "/listings", {
      listings: [
        { shopId: "northwind", upc: WINIX, priceMinor: PRICE + 400, currency: "USD" },
        { shopId: "lumen", upc: WINIX, priceMinor: PRICE, currency: "USD" },
      ],
    });

    // 1. Deposits are real (simulated) Orders v2 captures, and a retry never charges twice.
    for (const brand of ["winix", "levoit"]) {
      const r = await call<Json>("POST", `/brands/${brand}/deposits`, { amountMinor: 100_000 });
      expect(r.status).toBe(201);
      expect(r.json.status).toBe("captured");
    }
    const again = await call<Json>("POST", "/brands/winix/deposits", { amountMinor: 100_000 });
    expect(again.json.captureId).toBeTruthy();
    const { mock } = getPayPal(e);
    expect(mock?.state.captures.size).toBe(2);

    // 2. Sales and sessions arrive, then the engine credits what the test caused.
    await seedExperiment();
    const lift = await call<Json>("GET", "/lift/winix");
    expect(lift.json.exposedSales).toBe(200);
    expect(lift.json.causedUnits).toBe(102);
    expect(lift.json.lowerBound).toBeGreaterThan(0.37);
    expect(lift.json.perModel).toHaveLength(3);
    const rival = await call<Json>("GET", "/lift/levoit");
    expect(rival.json.causedUnits).toBe(0);
    expect(rival.json.lowerBound).toBeLessThan(0);

    const rec = await call<Json>("POST", "/credits/recompute");
    expect(rec.json.created).toBe(102);
    expect(rec.json.brands).toMatchObject([
      { brandId: "levoit", causedUnits: 0, newCredits: 0 },
      { brandId: "winix", causedUnits: 102, newCredits: 102 },
    ]);
    expect((await call<Json>("POST", "/credits/recompute")).json.created).toBe(0);

    const before = await call<Json>("GET", "/credits");
    expect(before.json.creators).toHaveLength(1);
    expect(before.json.creators[0].totals).toEqual({ pending: 78_328, voided: 0, paid: 0 });

    // Nothing is paid inside the 30-day hold.
    expect(((await call<Json>("POST", "/payouts/run")).json as Json).status).toBe("nothing_due");

    // 3. Day 30: one batch Payouts call to HouseFresh's PAYPAL_ID.
    const day30 = await call<Json>("POST", "/clock/advance", { to: "2026-12-02T00:00:00.000Z" });
    expect(day30.json.payout).toMatchObject({ status: "sent", batchStatus: "SUCCESS" });
    expect(mock?.state.batches.size).toBe(1);
    const batch = [...(mock?.state.batches.values() ?? [])][0];
    expect(batch?.items).toHaveLength(1);
    expect(batch?.items[0]?.req).toMatchObject({
      receiver: "HOUSEFRESH-PP",
      recipient_type: "PAYPAL_ID",
    });
    expect(batch?.items[0]?.amount).toEqual({ amountMinor: 78_328, currency: "USD" });

    const paid = await call<Json>("GET", "/credits");
    expect(paid.json.creators[0].totals).toEqual({ pending: 0, voided: 0, paid: 78_328 });
    expect(paid.json.creators[0].credits[0].payoutStatus).toBe("SUCCESS");

    // A retry (credits reset after a crash that lost the DB write) reuses the batch, no second payout.
    await e.DB.prepare("UPDATE credits SET state = 'pending', payout_batch_id = NULL").run();
    const retry = await call<Json>("POST", "/payouts/run");
    expect(retry.json.senderBatchId).toBe(day30.json.payout.senderBatchId);
    expect(mock?.state.batches.size).toBe(1);
    expect((await call<Json>("GET", "/credits")).json.creators[0].totals.paid).toBe(78_328);

    // 4. End of cycle: unspent deposits go back through captures/{id}/refund.
    const close = await call<Json>("POST", "/cycle/close");
    const byBrand = Object.fromEntries(close.json.brands.map((b: Json) => [b.brandId, b]));
    expect(byBrand.winix).toMatchObject({ spent: 78_328, returnedNow: 21_672, reserved: 0 });
    expect(byBrand.levoit).toMatchObject({ spent: 0, returnedNow: 100_000 });
    const refunded = [...(mock?.state.captures.values() ?? [])]
      .map((c) => c.refunded)
      .sort((a, b) => a - b);
    expect(refunded).toEqual([21_672, 100_000]);
    expect(
      (await call<Json>("POST", "/cycle/close")).json.brands.map((b: Json) => b.returnedNow),
    ).toEqual([0, 0]);

    // 5. Everything reconciles to the cent.
    const deposits = await call<Json>("GET", "/deposits");
    for (const b of deposits.json.brands) {
      expect(b.spent + b.returned + b.reserved + b.available).toBe(b.deposited);
    }
    const winix = deposits.json.brands.find((b: Json) => b.brandId === "winix");
    expect(winix).toMatchObject({
      deposited: 100_000,
      spent: 78_328,
      returned: 21_672,
      available: 0,
    });
    expect(winix.refunds).toHaveLength(1);

    // 6. The read API for AG Studio.
    const caused = await call<Json>("GET", "/caused-units");
    expect(caused.json.skus).toMatchObject([
      { brandId: "levoit", causedUnits: 0 },
      { brandId: "winix", causedUnits: 102, exposedSales: 200 },
    ]);
    const j = await call<Json>("GET", "/journeys?limit=200");
    const trip = j.json.journeys.find(
      (x: Json) => x.items[0].upc === WINIX && x.commission.paid > 0,
    );
    expect(trip).toMatchObject({
      storeChosen: "lumen",
      storesViewed: ["northwind", "lumen"],
      priceSavedMinor: 400,
      holdStatus: "paid",
      arm: "test",
    });
    expect(trip.shapley[0].shares).toEqual([
      { creatorId: "housefresh", amountMinor: expect.any(Number), state: "paid" },
    ]);
    const sh = await call<Json>("GET", "/shapley");
    expect(sh.json.sales).toHaveLength(102);
    expect(sh.json.sales.reduce((a: number, s: Json) => a + s.totalMinor, 0)).toBe(78_328);
    expect((await call<Json>("GET", "/payouts")).json.batches).toHaveLength(1);
  });
});
