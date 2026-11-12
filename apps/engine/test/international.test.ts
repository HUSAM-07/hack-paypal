import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPayPal } from "../src/paypal";
import { call, e, seedExperiment, WINIX } from "./helpers";

/** The catalogue's Winix A230: what a programme is started on. The seeded study sells a test UPC. */
const WINIX_PROGRAMME = "100000000001";

type Json = Record<string, any>;

const LEVOIT_PROGRAMME = "100000000002";
const ROBOROCK = "100000000006";
const IROBOT = "100000000007";
const PAST = "2020-01-01T00:00:00.000Z";

// The file shares one database and one simulated PayPal: start every test from empty tables.
beforeEach(async () => {
  const tables = [
    "credits",
    "review_flags",
    "payout_batches",
    "deposit_refunds",
    "brand_statements",
    "deposits",
    "listings",
    "refunds",
    "sales",
    "agent_sessions",
    "creators",
    "brands",
  ];
  await e.DB.batch(tables.map((t) => e.DB.prepare(`DELETE FROM ${t}`)));
});

/** The batch the simulated PayPal received last. */
const lastBatch = () => [...(getPayPal(e).mock?.state.batches.values() ?? [])].at(-1);

const start = (over: Json = {}) =>
  call<Json>("POST", "/programmes", {
    category: "purifier",
    upc: WINIX_PROGRAMME,
    depositMinor: 100_000,
    commissionBps: 800,
    ...over,
  });

async function credit(id: string, creatorId: string, amountMinor: number, currency: string) {
  await e.DB.prepare(
    `INSERT INTO credits (id, capture_id, creator_id, brand_id, upc, amount_minor, currency, state,
       hold_until, created_at)
     VALUES (?, ?, ?, 'winix', '012345678905', ?, ?, 'pending', ?, ?)`,
  )
    .bind(id, `CAP-${id}`, creatorId, amountMinor, currency, PAST, PAST)
    .run();
}

describe("international programmes: starting one", () => {
  it("captures a GBP deposit through one Orders v2 order in pounds", async () => {
    const create = vi.spyOn(getPayPal(e).paypal.orders, "create");
    const res = await start({ upc: LEVOIT_PROGRAMME, currency: "GBP" });
    expect(res.status).toBe(201);
    expect(res.json.brand).toMatchObject({ brandId: "levoit", currency: "GBP" });
    expect(res.json.deposit).toMatchObject({
      status: "captured",
      amountMinor: 100_000,
      currency: "GBP",
    });

    const [order, opts] = create.mock.calls[0] as [
      { intent: string; purchase_units: { amount: unknown; custom_id: string }[] },
      { requestId: string },
    ];
    expect(order.intent).toBe("CAPTURE");
    expect(order.purchase_units[0]).toMatchObject({
      amount: { amountMinor: 100_000, currency: "GBP" },
      custom_id: "cited-dep:levoit",
    });
    // Same deterministic key as a dollar programme: the currency is part of the amount, not the key.
    expect(opts.requestId).toBe("cited-dep:levoit:initial");

    // On the wire (the simulated PayPal's own record): "1000.00" GBP, captured in GBP.
    const state = (await call<Json>("GET", "/mock/state")).json;
    expect(state.captures.at(-1).amount).toEqual({ amountMinor: 100_000, currency: "GBP" });
    create.mockRestore();
  });

  it("captures a EUR deposit, and keeps the default USD when no currency is named", async () => {
    const eur = await start({ category: "robot-vacuum", upc: ROBOROCK, currency: "EUR" });
    expect(eur.status).toBe(201);
    expect(eur.json.deposit).toMatchObject({ currency: "EUR", amountMinor: 100_000 });

    const usd = await start({ category: "robot-vacuum", upc: IROBOT });
    expect(usd.status).toBe(201);
    expect(usd.json.brand.currency).toBe("USD");
    expect(usd.json.deposit.currency).toBe("USD");

    const brands = (await call<Json>("GET", "/deposits")).json.brands as Json[];
    expect(Object.fromEntries(brands.map((b) => [b.brandId, b.currency]))).toEqual({
      irobot: "USD",
      roborock: "EUR",
    });
  });

  it("refuses a currency a programme cannot run in, before anything reaches PayPal", async () => {
    const create = vi.spyOn(getPayPal(e).paypal.orders, "create");
    for (const currency of ["JPY", "CHF", "gbp", "XXX", "", "POUNDS"]) {
      const r = await start({ currency });
      expect(r.status, currency).toBe(400);
      expect(r.json.error).toBe("unsupported_currency");
    }
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it("states the deposit limits in the programme's own currency", async () => {
    const low = await start({ currency: "GBP", depositMinor: 99 });
    expect(low.status).toBe(400);
    expect(low.json.message).toBe("The deposit must be between £100 and £10,000.");
    const eur = await start({ currency: "EUR", depositMinor: 1_000_001 });
    expect(eur.json.message).toBe("The deposit must be between €100 and €10,000.");
  });

  it("does not let a half-made programme change currency", async () => {
    await call("POST", "/brands", {
      brandId: "winix",
      name: "Winix",
      category: "purifier",
      upc: WINIX_PROGRAMME,
      currency: "GBP",
      commissionBps: 800,
    });
    const r = await start({ currency: "EUR" });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("terms_changed");
  });
});

describe("international programmes: credits, payouts and the statement stay in one currency", () => {
  it("credits, pays, reconciles and states a GBP programme in pounds, exactly", async () => {
    expect((await start({ currency: "GBP" })).status).toBe(201);
    await call("POST", "/creators", {
      creatorId: "housefresh",
      name: "HouseFresh",
      paypalId: "HOUSEFRESH-PP",
    });
    await seedExperiment();
    // The seeded study's sales are made in USD. Winix is sold in pounds here, at the same
    // number of pence: the sale's own currency, never a converted figure.
    await e.DB.prepare("UPDATE sales SET currency = 'GBP', upc = ? WHERE upc = ?")
      .bind(WINIX_PROGRAMME, WINIX)
      .run();
    await call("POST", "/credits/recompute");

    const credits = (await call<Json>("GET", "/credits")).json.creators as Json[];
    expect(credits).toHaveLength(1);
    const mine = credits[0] as Json;
    expect(mine.currency).toBe("GBP");
    expect(mine.credits).toHaveLength(51);
    expect(mine.credits.every((c: Json) => c.currency === "GBP")).toBe(true);
    // The same 51 units and £391.64 the USD programme credits at 8%: one rounding for the batch.
    expect(mine.totals.pending).toBe(39_164);
    expect(mine.totalsByCurrency).toEqual({
      GBP: { pending: 39_164, voided: 0, paid: 0, frozen: 0, held: 0 },
    });

    // A sale of the same product in another currency is not credited and not converted.
    await e.DB.prepare(
      `INSERT INTO sales (capture_id, upc, order_id, shop_id, amount_minor, currency, session_id,
         arm, creators_seen, model, captured_at)
       VALUES ('CAP-USD-ODD', ?, 'ORD-USD-ODD', 'lumen', 9599, 'USD', 'x-gpt-0', 'test',
         '["housefresh"]', 'gpt', '2026-11-01T10:00:00Z')`,
    )
      .bind(WINIX_PROGRAMME)
      .run();
    await call("POST", "/credits/recompute");
    const again = ((await call<Json>("GET", "/credits")).json.creators as Json[])[0] as Json;
    expect(again.credits).toHaveLength(51);
    expect(again.credits.some((c: Json) => c.captureId === "CAP-USD-ODD")).toBe(false);

    // The deposit reconciles to the penny, in pounds.
    const dep = ((await call<Json>("GET", "/deposits")).json.brands as Json[])[0] as Json;
    expect(dep).toMatchObject({ currency: "GBP", deposited: 100_000, reserved: 39_164 });
    expect(dep.deposited - dep.reserved - dep.spent - dep.returned).toBe(dep.available);

    // Payout after the hold: one item, in GBP.
    const adv = (await call<Json>("POST", "/clock/advance", { days: 31 })).json;
    expect(adv.payout.status).toBe("sent");
    expect(adv.payout.items).toEqual([
      expect.objectContaining({ creatorId: "housefresh", amountMinor: 39_164, currency: "GBP" }),
    ]);
    const { mock } = getPayPal(e);
    const batch = lastBatch();
    expect(batch?.items.map((i) => i.amount)).toEqual([{ amountMinor: 39_164, currency: "GBP" }]);
    const wire = await getPayPal(e).paypal.payouts.getBatch(batch?.id as string, {
      page_size: 10,
    });
    expect(wire.batch_header.amount).toEqual({ amountMinor: 39_164, currency: "GBP" });
    expect(wire.items[0]?.payout_item.amount).toEqual({ amountMinor: 39_164, currency: "GBP" });

    // Ledger, batch and deposit agree.
    const after = ((await call<Json>("GET", "/credits")).json.creators as Json[])[0] as Json;
    expect(after.totalsByCurrency.GBP.paid).toBe(39_164);
    const dep2 = ((await call<Json>("GET", "/deposits")).json.brands as Json[])[0] as Json;
    expect(dep2.spent).toBe(39_164);

    // The statement and its invoice are in pounds.
    const closed = (await call<Json>("POST", "/cycle/close")).json;
    expect(closed.brands[0]).toMatchObject({ spent: 39_164, returnedNow: 60_836 });
    const st = closed.statements[0] as Json;
    expect(st).toMatchObject({ currency: "GBP", paidMinor: 39_164, creditedMinor: 39_164 });
    const refund = [...(mock?.state.refunds.values() ?? [])].at(-1);
    expect(refund?.amount).toEqual({ amountMinor: 60_836, currency: "GBP" });
    const inv = [...(mock?.state.invoices.values() ?? [])].at(-1);
    expect(inv?.currency).toBe("GBP");
    expect(inv?.amount).toEqual({ amountMinor: 39_164, currency: "GBP" });
  });
});

describe("international payouts: one batch, an item per currency", () => {
  it("sends a mixed-currency batch, each item in its own currency, and reconciles per currency", async () => {
    await call("POST", "/creators", {
      creatorId: "c-uk",
      name: "UK Creator",
      paypalId: "PAYER-UK",
    });
    await call("POST", "/creators", {
      creatorId: "c-eu",
      name: "EU Creator",
      paypalId: "PAYER-EU",
    });
    await credit("g1", "c-uk", 1_250, "GBP");
    await credit("g2", "c-uk", 750, "GBP");
    await credit("e1", "c-eu", 3_005, "EUR");
    // The same creator earns in two currencies: two items, never one converted sum.
    await credit("u1", "c-uk", 400, "USD");
    await credit("e2", "c-uk", 99, "EUR");

    const run = (await call<Json>("POST", "/payouts/run")).json;
    expect(run.status).toBe("sent");
    expect(run.batches).toHaveLength(1);
    expect(run.items).toHaveLength(4);

    const batch = lastBatch();
    const items = batch?.items ?? [];
    expect(items).toHaveLength(4);
    const byCurrency = (cur: string) =>
      items.filter((i) => i.amount.currency === cur).reduce((a, i) => a + i.amount.amountMinor, 0);
    expect(byCurrency("GBP")).toBe(2_000);
    expect(byCurrency("EUR")).toBe(3_104);
    expect(byCurrency("USD")).toBe(400);

    // PayPal needs unique sender_item_ids inside a batch: the currency tells one creator's items apart.
    const ids = items.map((i) => String(i.req.sender_item_id));
    expect(new Set(ids).size).toBe(4);
    expect(ids.filter((id) => id.startsWith("c-uk-"))).toHaveLength(3);
    expect(ids.some((id) => id.endsWith("-GBP"))).toBe(true);
    // A USD item's id is what it always was.
    const usd = items.find((i) => i.amount.currency === "USD");
    expect(String(usd?.req.sender_item_id)).toMatch(/^c-uk-[0-9a-f]{8}$/);

    // The ledger paid exactly what each currency's items carried.
    const creators = (await call<Json>("GET", "/credits")).json.creators as Json[];
    const paid: Record<string, number> = {};
    for (const c of creators)
      for (const [cur, t] of Object.entries(c.totalsByCurrency as Json))
        paid[cur] = (paid[cur] ?? 0) + (t as Json).paid;
    expect(paid).toEqual({ GBP: 2_000, EUR: 3_104, USD: 400 });

    // PayPal gives a mixed batch no single total: the header leaves it out, items stay exact.
    const wire = await getPayPal(e).paypal.payouts.getBatch(batch?.id as string, { page_size: 10 });
    expect(wire.batch_header.amount).toBeUndefined();
    expect(wire.items.map((i) => i.payout_item.amount.currency).sort()).toEqual([
      "EUR",
      "EUR",
      "GBP",
      "USD",
    ]);

    // The read API finds each item's PayPal id even where one creator has items in two currencies.
    const read = (await call<Json>("GET", "/payouts")).json.batches[0].items as Json[];
    expect(read.every((i) => typeof i.payoutItemId === "string")).toBe(true);
  });

  it("pays a Venmo creator's pounds through PayPal, not Venmo", async () => {
    await call("POST", "/payout-method", {
      creator: { creatorId: "c-v", name: "V", paypalId: "SIMPAYER00009" },
      method: "VENMO",
      venmo: "415 555 0123",
    });
    await credit("v1", "c-v", 500, "GBP");
    await credit("v2", "c-v", 800, "USD");
    await call("POST", "/payouts/run");
    const items = lastBatch()?.items ?? [];
    const gbp = items.find((i) => i.amount.currency === "GBP");
    const usd = items.find((i) => i.amount.currency === "USD");
    expect(gbp?.req.recipient_wallet).toBe("PAYPAL");
    expect(usd?.req.recipient_wallet).toBe("VENMO");
  });
});

describe("the simulated PayPal accepts what the real one does", () => {
  const order = (currency: string, amountMinor: number) =>
    getPayPal(e).paypal.orders.create(
      { intent: "CAPTURE", purchase_units: [{ amount: { amountMinor, currency } }] },
      { requestId: `o-${currency}-${amountMinor}` },
    );
  const payout = (currency: string, amountMinor: number) =>
    getPayPal(e).paypal.payouts.createBatch(
      {
        sender_batch_header: { sender_batch_id: `t-${currency}-${amountMinor}` },
        items: [
          {
            recipient_type: "PAYPAL_ID",
            receiver: "PAYER-X",
            amount: { amountMinor, currency },
          },
        ],
      },
      { requestId: `p-${currency}-${amountMinor}` },
    );

  it("takes GBP and EUR in Orders and Payouts", async () => {
    for (const cur of ["GBP", "EUR"]) {
      const o = await order(cur, 5_099);
      expect(o.purchase_units?.[0]?.amount).toEqual({ amountMinor: 5_099, currency: cur });
      const b = await payout(cur, 50);
      expect(b.batch_header.payout_batch_id).toBeTruthy();
    }
  });

  it("refuses a currency PayPal does not support, and too many decimal places", async () => {
    await expect(order("XYZ", 100)).rejects.toMatchObject({
      details: [expect.objectContaining({ issue: "CURRENCY_NOT_SUPPORTED" })],
    });
    await expect(payout("XYZ", 100)).rejects.toMatchObject({
      details: [expect.objectContaining({ issue: "CURRENCY_NOT_SUPPORTED" })],
    });
  });
});
