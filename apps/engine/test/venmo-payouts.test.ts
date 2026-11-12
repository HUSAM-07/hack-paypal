import { describe, expect, it } from "vitest";
import { parseVenmoReceiver } from "../src/payout-method";
import { getPayPal } from "../src/paypal";
import { statementInvoice, statementLines } from "../src/statements";
import { call, e } from "./helpers";

type Json = Record<string, any>;

const PAST = "2020-01-01T00:00:00.000Z";

async function credit(id: string, creatorId: string, amountMinor: number, currency = "USD") {
  await e.DB.prepare(
    `INSERT INTO credits (id, capture_id, creator_id, brand_id, upc, amount_minor, currency, state,
       hold_until, created_at)
     VALUES (?, ?, ?, 'winix', '012345678905', ?, ?, 'pending', ?, ?)`,
  )
    .bind(id, `CAP-${id}`, creatorId, amountMinor, currency, PAST, PAST)
    .run();
}

const PAYER = (n: number) => `SIMPAYER${String(n).padStart(5, "0")}`;

async function onboard(creatorId: string, n: number, venmo?: string) {
  return call<Json>("POST", "/payout-method", {
    creator: { creatorId, name: `Creator ${n}`, paypalId: PAYER(n) },
    method: venmo ? "VENMO" : "PAYPAL",
    ...(venmo ? { venmo } : {}),
  });
}

/** The item PayPal's simulator holds for one creator, across every batch so far. */
function sentItem(creatorId: string) {
  const { mock } = getPayPal(e);
  return [...(mock?.state.batches.values() ?? [])]
    .flatMap((b) => b.items)
    .find((i) => String(i.req.sender_item_id).startsWith(`${creatorId}-`));
}

describe("parseVenmoReceiver", () => {
  it("turns a US mobile number into PayPal's dashed phone form", () => {
    for (const typed of ["415 555 0123", "(415) 555-0123", "+1 415-555-0123", "14155550123"])
      expect(parseVenmoReceiver(typed)).toEqual({
        ok: true,
        value: { type: "PHONE", receiver: "1-415-555-0123" },
      });
  });
  it("takes a Venmo username with or without the @", () => {
    expect(parseVenmoReceiver("quiet-rooms")).toEqual({
      ok: true,
      value: { type: "USER_HANDLE", receiver: "@quiet-rooms" },
    });
    expect(parseVenmoReceiver("@quiet_rooms")).toMatchObject({ ok: true });
  });
  it("rejects blanks, short numbers, non-US numbers and bad usernames", () => {
    for (const bad of [
      "",
      "   ",
      "555 0123",
      "+44 7700 900123",
      "0155550123",
      "ab",
      "has space",
      "x".repeat(41),
      undefined,
    ])
      expect(parseVenmoReceiver(bad).ok).toBe(false);
  });
});

describe("payouts to Venmo", () => {
  it("sends PayPal and Venmo items in one batch with the right request shape, and reconciles", async () => {
    expect((await onboard("c-paypal", 1)).status).toBe(200);
    expect((await onboard("c-phone", 2, "(415) 555-0123")).status).toBe(200);
    expect((await onboard("c-handle", 3, "@quiet-rooms")).status).toBe(200);
    await credit("k1", "c-paypal", 1_000);
    await credit("k2", "c-phone", 2_500);
    await credit("k3", "c-phone", 500);
    await credit("k4", "c-handle", 4_000);

    const run = (await call<Json>("POST", "/payouts/run")).json;
    expect(run.status).toBe("sent");
    expect(run.batches).toHaveLength(1);

    const { mock } = getPayPal(e);
    expect(mock?.state.batches.size).toBe(1);
    const batch = [...(mock?.state.batches.values() ?? [])][0];
    const byCreator = sentItem;

    // The PayPal creator's item is exactly what it was before Venmo existed.
    expect(byCreator("c-paypal")?.req).toMatchObject({
      recipient_type: "PAYPAL_ID",
      receiver: PAYER(1),
      recipient_wallet: "PAYPAL",
    });
    // Venmo items follow PayPal's "Payouts to Venmo": wallet, phone or handle, a note, USD.
    expect(byCreator("c-phone")?.req).toMatchObject({
      recipient_type: "PHONE",
      receiver: "1-415-555-0123",
      recipient_wallet: "VENMO",
      note: "CITED: commission on sales your test caused",
    });
    expect(byCreator("c-handle")?.req).toMatchObject({
      recipient_type: "USER_HANDLE",
      receiver: "@quiet-rooms",
      recipient_wallet: "VENMO",
    });
    expect(byCreator("c-phone")?.amount).toEqual({ amountMinor: 3_000, currency: "USD" });

    // Reconciliation is exact: the batch total, the ledger and each creator's item agree.
    const credits = (await call<Json>("GET", "/credits")).json;
    const paid = Object.fromEntries(
      credits.creators.map((c: Json) => [c.creatorId, c.totals.paid]),
    );
    expect(paid).toEqual({ "c-paypal": 1_000, "c-phone": 3_000, "c-handle": 4_000 });
    expect(batch?.items.reduce((a, i) => a + i.amount.amountMinor, 0)).toBe(8_000);
    expect(
      credits.creators.flatMap((c: Json) => c.credits.map((x: Json) => x.payoutStatus)),
    ).toEqual(expect.arrayContaining(["SUCCESS"]));

    // What the console and statements read: the wallet, and never the phone number.
    const items = (await call<Json>("GET", "/payouts")).json.batches[0].items as Json[];
    const forCreator = (c: string) => items.find((i) => i.creatorId === c) as Json;
    expect(forCreator("c-paypal").wallet).toBeUndefined();
    expect(forCreator("c-paypal").receiver).toBe(PAYER(1));
    expect(forCreator("c-phone")).toMatchObject({ wallet: "VENMO", receiver: "Venmo ···0123" });
    expect(forCreator("c-handle")).toMatchObject({
      wallet: "VENMO",
      receiver: "Venmo @quiet-rooms",
    });
    const stored = await e.DB.prepare("SELECT items_json FROM payout_batches").first<Json>();
    expect(stored?.items_json).not.toContain("555-0123");
    expect(run.items.find((i: Json) => i.creatorId === "c-phone")).toMatchObject({
      wallet: "VENMO",
      receiver: "Venmo ···0123",
    });
  });

  it("pays a Venmo creator through PayPal when the credit is not in US dollars", async () => {
    await onboard("c-eur", 4, "415 555 0199");
    await credit("e1", "c-eur", 700, "EUR");
    const run = (await call<Json>("POST", "/payouts/run")).json;
    expect(run.status).toBe("sent");
    expect(sentItem("c-eur")?.req).toMatchObject({
      recipient_type: "PAYPAL_ID",
      receiver: PAYER(4),
      recipient_wallet: "PAYPAL",
    });
    expect(run.items[0].wallet).toBeUndefined();
  });

  it("switching back to PayPal pays the payer id again and forgets the Venmo detail", async () => {
    await onboard("c-back", 5, "@someone-else");
    await onboard("c-back", 5);
    const row = await e.DB.prepare("SELECT * FROM creators WHERE creator_id = 'c-back'").first();
    expect(row).toMatchObject({
      payout_wallet: "PAYPAL",
      venmo_receiver: null,
      venmo_receiver_type: null,
    });
    await credit("b1", "c-back", 900);
    await call("POST", "/payouts/run");
    expect(sentItem("c-back")?.req).toMatchObject({
      recipient_type: "PAYPAL_ID",
    });
  });
});

describe("/payout-method", () => {
  it("rejects a bad Venmo receiver, a missing one, and a demo creator", async () => {
    const bad = await onboard("c-bad", 6, "12345");
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatch(/US mobile number/);
    const none = await call("POST", "/payout-method", {
      creator: { creatorId: "c-bad", name: "X", paypalId: PAYER(6) },
      method: "VENMO",
    });
    expect(none.status).toBe(400);
    expect(
      (await call("POST", "/payout-method", { creator: { creatorId: "c-bad" }, method: "VENMO" }))
        .status,
    ).toBe(400);
    await call("POST", "/creators", {
      creatorId: "housefresh",
      name: "HouseFresh",
      paypalId: "HF",
    });
    expect((await onboard("housefresh", 7, "@hf-venmo")).status).toBe(409);
    expect(
      await e.DB.prepare(
        "SELECT payout_wallet FROM creators WHERE creator_id = 'housefresh'",
      ).first(),
    ).toEqual({ payout_wallet: "PAYPAL" });
    expect(
      await e.DB.prepare("SELECT 1 FROM creators WHERE creator_id = 'c-bad'").first(),
    ).toBeNull();
  });

  it("reads back the method with a masked label, never the full receiver", async () => {
    await onboard("c-read", 8, "415-555-0142");
    const got = await call<Json>("GET", "/payout-method?creatorId=c-read");
    expect(got.json).toEqual({ method: "VENMO", label: "Venmo ···0142" });
    expect((await call<Json>("GET", "/payout-method?creatorId=nobody")).json).toEqual({
      method: "PAYPAL",
      label: null,
    });
  });

  it("keeps the choice when the creator publishes a test", async () => {
    await onboard("c-keep", 9, "@keeper");
    const A = { upc: "100000000001", brand: "Winix", name: "A230" };
    const B = { upc: "100000000002", brand: "Levoit", name: "Core 300" };
    const disclosure = "I may earn a commission from CITED when an agent buys after reading this.";
    const r = await call("POST", "/tests", {
      creator: { creatorId: "c-keep", name: "Keeper", paypalId: PAYER(9) },
      test: {
        id: "c-keep-t1",
        kind: "test",
        creatorId: "c-keep",
        category: "air-purifier",
        skus: [A, B],
        summary: "Same room, same smoke load; the A230 cleared it faster.",
        disclosure,
      },
      placebo: {
        id: "c-keep-p1",
        kind: "placebo",
        creatorId: "c-keep",
        category: "desk-lamp",
        skus: [],
        summary: "A review of three desk lamps.",
        disclosure,
      },
    });
    expect(r.status).toBe(201);
    expect((await call<Json>("GET", "/payout-method?creatorId=c-keep")).json.method).toBe("VENMO");
  });
});

describe("statements", () => {
  const credits = [
    { creatorId: "a", amount: { amountMinor: 500, currency: "USD" }, state: "paid" as const },
    { creatorId: "b", amount: { amountMinor: 700, currency: "USD" }, state: "paid" as const },
  ];
  const names = new Map([
    ["a", "Alpha"],
    ["b", "Bravo"],
  ]);
  const stmt = (lines: ReturnType<typeof statementLines>) => ({
    id: "stmt-x",
    invoiceNumber: "CITED-X",
    currency: "USD",
    creditedMinor: 1200,
    voidedMinor: 0,
    paidMinor: 1200,
    returnedMinor: 0,
    depositedMinor: 5000,
    reservedMinor: 0,
    payoutBatchIds: [],
    refundIds: [],
    lines,
  });
  const opts = {
    brandName: "Winix",
    captureIds: [],
    day: "2026-12-02",
    recipientEmail: "b@x.test",
  };

  it("marks only the Venmo creator's line, and says paid to Venmo on the invoice", () => {
    const lines = statementLines(credits, names, new Set(["b"]));
    expect(lines.map((l) => l.wallet)).toEqual([undefined, "VENMO"]);
    const inv = statementInvoice(stmt(lines) as never, opts);
    expect(inv.items?.[0]?.description).toContain("$5.00 paid through PayPal Payouts.");
    expect(inv.items?.[1]?.description).toContain("$7.00 paid through PayPal Payouts to Venmo.");
  });

  it("leaves every line exactly as before when nobody is on Venmo", () => {
    const lines = statementLines(credits, names);
    expect(lines.every((l) => !("wallet" in l))).toBe(true);
  });
});
