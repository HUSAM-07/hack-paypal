import { env } from "cloudflare:workers";
import { type PassportBody, signPassport } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";

const e = env as unknown as Env;
const KEY = "test-passport-key";

const body = (over: Partial<PassportBody> = {}): PassportBody => ({
  v: 1,
  sessionId: "sess1",
  arm: "test",
  creatorsSeen: ["housefresh", "airlab"],
  storesViewed: ["northwind"],
  ...over,
});

let seq = 0;
const eid = () => `WH-${++seq}-${crypto.randomUUID().slice(0, 6)}`;
const usd = (value: string) => ({ currency_code: "USD", value });

function post(event: Record<string, unknown>, mode = "simulated", headers: HeadersInit = {}) {
  return app.request(
    "/webhooks/paypal",
    { method: "POST", body: JSON.stringify(event), headers },
    { ...e, PAYPAL_MODE: mode },
  );
}

const approved = (
  orderId: string,
  customId: string | undefined,
  shop = "lumen",
  upc = "012345678905",
) => ({
  id: eid(),
  event_type: "CHECKOUT.ORDER.APPROVED",
  resource: {
    id: orderId,
    status: "APPROVED",
    purchase_units: [
      {
        reference_id: shop,
        ...(customId ? { custom_id: customId } : {}),
        payee: { merchant_id: shop },
        items: [
          {
            name: "Purifier",
            quantity: "2",
            unit_amount: usd("50.00"),
            upc: { type: "UPC-A", code: upc },
          },
        ],
      },
    ],
  },
});

const captured = (captureId: string, orderId: string, customId?: string) => ({
  id: eid(),
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: {
    id: captureId,
    status: "COMPLETED",
    amount: usd("100.00"),
    ...(customId ? { custom_id: customId } : {}),
    create_time: "2026-11-01T10:00:00Z",
    supplementary_data: { related_ids: { order_id: orderId } },
  },
});

const sale = (captureId: string) =>
  e.DB.prepare("SELECT * FROM sales WHERE capture_id = ?")
    .bind(captureId)
    .first<Record<string, unknown>>();

describe("capture join", () => {
  it("joins a cross-shop sale (test shown at Northwind, paid at Lumen) to its arm", async () => {
    await e.DB.prepare("INSERT INTO agent_sessions VALUES (?, ?, ?)")
      .bind("sess1", "gpt", "now")
      .run();
    const token = await signPassport(body(), KEY);
    expect((await post(approved("O-1", token))).status).toBe(200);
    expect((await post(captured("C-1", "O-1", token))).status).toBe(200);
    expect(await sale("C-1")).toMatchObject({
      shop_id: "lumen",
      upc: "012345678905",
      amount_minor: 10_000,
      session_id: "sess1",
      arm: "test",
      model: "gpt",
      creators_seen: '["housefresh","airlab"]',
      unattributed_reason: null,
    });
  });

  it("takes custom_id from the stored order when the capture lacks it", async () => {
    const token = await signPassport(body({ sessionId: "sess2", arm: "placebo" }), KEY);
    await post(approved("O-2", token));
    await post(captured("C-2", "O-2"));
    expect(await sale("C-2")).toMatchObject({ session_id: "sess2", arm: "placebo" });
  });

  it("stores forged, tampered and missing passports as unattributed", async () => {
    const good = await signPassport(body(), KEY);
    const cases: [string, string | undefined, string][] = [
      ["C-3", good.replace("|test|", "|none|"), "bad_signature"],
      ["C-4", await signPassport(body(), "other-key"), "bad_signature"],
      ["C-5", "garbage", "malformed"],
      ["C-6", undefined, "missing_passport"],
    ];
    for (const [cap, custom, reason] of cases) {
      await post(approved(`O-${cap}`, custom));
      await post(captured(cap, `O-${cap}`, custom));
      expect(await sale(cap)).toMatchObject({
        session_id: null,
        arm: null,
        unattributed_reason: reason,
      });
    }
  });
});

describe("intake", () => {
  it("dedupes by event id", async () => {
    const ev = captured("C-7", "O-7", await signPassport(body(), KEY));
    await post(approved("O-7", undefined));
    expect(await (await post(ev)).json()).toEqual({ ok: true });
    expect(await (await post(ev)).json()).toEqual({ ok: true, duplicate: true });
    const n = await e.DB.prepare("SELECT COUNT(*) AS n FROM sales WHERE capture_id = 'C-7'").first<{
      n: number;
    }>();
    expect(n?.n).toBe(1);
  });

  it("returns 200 for unknown event types", async () => {
    const res = await post({ id: eid(), event_type: "SOMETHING.NEW", resource: {} });
    expect(res.status).toBe(200);
  });

  it("stores refunds and disputes against the capture", async () => {
    await post({
      id: eid(),
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "R-1",
        status: "COMPLETED",
        amount: usd("40.00"),
        links: [{ rel: "up", href: "https://api.paypal.com/v2/payments/captures/C-1" }],
      },
    });
    await post({
      id: eid(),
      event_type: "CUSTOMER.DISPUTE.CREATED",
      resource: {
        dispute_id: "PP-D-1",
        status: "OPEN",
        dispute_amount: usd("100.00"),
        disputed_transactions: [{ seller_transaction_id: "C-1" }],
      },
    });
    const rows = await e.DB.prepare(
      "SELECT id, kind, amount_minor FROM refunds WHERE capture_id = 'C-1' ORDER BY id",
    ).all();
    expect(rows.results).toEqual([
      { id: "PP-D-1", kind: "dispute", amount_minor: 10_000 },
      { id: "R-1", kind: "refund", amount_minor: 4_000 },
    ]);
  });
});

describe("signature check", () => {
  it("rejects events without PayPal signature headers outside simulated mode", async () => {
    const res = await post(captured("C-8", "O-8"), "sandbox");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_headers" });
    expect(await sale("C-8")).toBeNull();
  });
});
