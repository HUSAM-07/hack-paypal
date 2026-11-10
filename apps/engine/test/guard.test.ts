import { describe, expect, it } from "vitest";
import { writeDenied } from "../src/api";
import { getPayPal } from "../src/paypal";
import { call, e, PRICE, seedExperiment, WINIX } from "./helpers";

type Json = Record<string, any>;

/** A test-arm session that bought one Winix, with the order's payer and the session's owner. */
async function selfDealtSale(n: number, o: { payerId?: string; ownerId?: string }) {
  const sessionId = `self-${n}`;
  const orderId = `ORD-SELF-${n}`;
  await e.DB.batch([
    e.DB.prepare(
      `INSERT INTO agent_sessions (session_id, model, created_at, arm, category, creators_seen,
         stores_viewed, owner_id)
       VALUES (?, 'gpt', '2026-11-01T11:00:00Z', 'test', 'purifier', '["housefresh"]', '[]', ?)`,
    ).bind(sessionId, o.ownerId ?? null),
    e.DB.prepare(
      `INSERT INTO orders (order_id, custom_id, shop_id, items_json, approved_at, payer_id)
       VALUES (?, NULL, 'lumen', '[]', '2026-11-01T11:00:00Z', ?)`,
    ).bind(orderId, o.payerId ?? `BUYER-SELF-${n}`),
    e.DB.prepare(
      `INSERT INTO sales (capture_id, upc, order_id, shop_id, amount_minor, currency, session_id,
         arm, creators_seen, model, captured_at)
       VALUES (?, ?, ?, 'lumen', ?, 'USD', ?, 'test', '["housefresh"]', 'gpt', '2026-11-01T11:00:00Z')`,
    ).bind(`CAP-SELF-${n}`, WINIX, orderId, PRICE, sessionId),
  ]);
  return `CAP-SELF-${n}:housefresh`;
}

describe("abuse guard", () => {
  it("holds self-dealt credits out of every payout, leaves the study's numbers alone, and lets a reviewer decide", async () => {
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

    // The creator buys through their own PayPal, and their own agent buys too.
    const viaWallet = await selfDealtSale(1, { payerId: "HOUSEFRESH-PP" });
    const viaAgent = await selfDealtSale(2, { ownerId: "housefresh" });

    // Neither enters the study: still 57 exposed sales → 51 caused units.
    const lift = await call<Json>("GET", "/lift/winix");
    expect(lift.json).toMatchObject({ exposedSales: 57, causedUnits: 51 });

    const rec = await call<Json>("POST", "/credits/recompute");
    expect(rec.json).toMatchObject({ created: 53, held: 2 });
    expect((await call<Json>("POST", "/credits/recompute")).json).toMatchObject({ created: 0 });

    const credits = await call<Json>("GET", "/credits");
    const hf = credits.json.creators[0];
    expect(hf.totals).toEqual({
      pending: 39_164 + 768 + 768,
      voided: 0,
      paid: 0,
      frozen: 0,
      held: 768 + 768,
    });
    const heldRow = hf.credits.find((x: Json) => x.id === viaWallet);
    expect(heldRow).toMatchObject({ amountMinor: 768, held: true, holdReasons: ["self_purchase"] });

    const flags = (await call<Json>("GET", "/review-flags?status=open")).json.flags as Json[];
    expect(flags.map((f) => [f.id, f.reason, f.hold, f.detail])).toEqual([
      [
        `self_purchase:${viaWallet}`,
        "self_purchase",
        true,
        "the buyer's PayPal account is the creator's",
      ],
      [
        `self_purchase:${viaAgent}`,
        "self_purchase",
        true,
        "the agent session belongs to the creator",
      ],
    ]);

    // Day 30: the honest $391.64 is paid; the held credits are not, and the run says so.
    const day30 = await call<Json>("POST", "/clock/advance", { to: "2026-12-02T00:00:00.000Z" });
    expect(day30.json.payout.items).toEqual([
      expect.objectContaining({ creatorId: "housefresh", amountMinor: 39_164 }),
    ]);
    expect(day30.json.payout.held.map((h: Json) => h.creditId).sort()).toEqual(
      [viaWallet, viaAgent].sort(),
    );
    const { mock } = getPayPal(e);
    const paidToPayPal = [...(mock?.state.batches.values() ?? [])]
      .flatMap((b) => b.items)
      .reduce((a, i) => a + i.amount.amountMinor, 0);
    expect(paidToPayPal).toBe(39_164);

    // A reviewer voids the wallet purchase and releases the agent one.
    const voided = await call<Json>(
      "POST",
      `/review-flags/${encodeURIComponent(`self_purchase:${viaWallet}`)}/void`,
    );
    expect(voided.json.flag).toMatchObject({ status: "voided", credit: { state: "voided" } });
    const again = await call<Json>(
      "POST",
      `/review-flags/${encodeURIComponent(`self_purchase:${viaWallet}`)}/release`,
    );
    expect(again).toMatchObject({ status: 409, json: { error: "already_voided" } });
    const released = await call<Json>(
      "POST",
      `/review-flags/${encodeURIComponent(`self_purchase:${viaAgent}`)}/release`,
    );
    expect(released.json.flag).toMatchObject({ status: "released", credit: { state: "pending" } });
    expect((await call<Json>("POST", "/review-flags/nope/void")).status).toBe(404);

    // The guard never reopens a decided hold; the released credit is paid in the next batch.
    await call("POST", "/credits/recompute");
    const next = await call<Json>("POST", "/payouts/run");
    expect(next.json.items).toEqual([
      expect.objectContaining({ creatorId: "housefresh", amountMinor: 768, creditIds: [viaAgent] }),
    ]);
    const end = (await call<Json>("GET", "/credits")).json.creators[0];
    expect(end.totals).toEqual({
      pending: 0,
      voided: 768,
      paid: 39_164 + 768,
      frozen: 0,
      held: 0,
    });
    expect(end.credits.find((x: Json) => x.id === viaWallet).voidReason).toBe("review");

    // Reconciles: the voided hold freed its share of the deposit.
    const winix = (await call<Json>("GET", "/deposits")).json.brands[0];
    expect(winix.spent + winix.returned + winix.reserved + winix.available).toBe(winix.deposited);
    expect(winix.reserved).toBe(0);
  });

  it("locks the reviewer's routes behind the write token", () => {
    const locked = { ENGINE_API_TOKEN: "s3cret", ENGINE_OPEN_API: undefined };
    expect(writeDenied(locked, "POST", undefined)).toEqual({ status: 401, error: "unauthorized" });
    expect(writeDenied(locked, "POST", "Bearer s3cret")).toBeNull();
    expect(writeDenied(locked, "GET", undefined)).toBeNull();
  });
});
