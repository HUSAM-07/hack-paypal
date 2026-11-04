import { describe, expect, it } from "vitest";
import { createPayPal } from "../client";
import { WebhookEvent } from "../webhooks/events";
import { verifyWebhookSelf } from "../webhooks/verify";
import { createPayPalFromEnv } from "./from-env";
import { createMockPayPal, MOCK_API_BASE, type WebhookDelivery } from "./paypal-mock";
import { validateResponse } from "./spec-validate";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const ORDERS = "checkout_orders_v2";
const PAYMENTS = "payments_payment_v2";
const PAYOUTS = "payments_payouts_batch_v1";

function setup(opts: Parameters<typeof createMockPayPal>[0] = {}) {
  let t = Date.parse("2026-11-05T10:00:00Z");
  const mock = createMockPayPal({ now: () => t, ...opts });
  const paypal = createPayPal({
    clientId: "id",
    clientSecret: "secret",
    env: "sandbox",
    fetch: mock.fetch,
    sleep: async () => {},
  });
  const deliveries: WebhookDelivery[] = [];
  mock.registerWebhook((d) => void deliveries.push(d));
  /** Raw call, bypassing the client's Zod stripping, for spec validation. */
  const raw = async (method: string, path: string, body?: unknown, reqId?: string) => {
    const res = await mock.fetch(`${MOCK_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: "Bearer x",
        "content-type": "application/json",
        ...(reqId ? { "PayPal-Request-Id": reqId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // biome-ignore lint/suspicious/noExplicitAny: raw JSON in tests
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  return { mock, paypal, deliveries, raw, tick: (ms: number) => (t += ms) };
}

const unit = {
  amount: usd(2500),
  custom_id: "passport.v1.abc",
  items: [
    {
      name: "Trail shoe",
      quantity: "1",
      unit_amount: { currency_code: "USD", value: "25.00" },
      upc: { type: "UPC-A", code: "012345678905" },
    },
  ],
};
const rawUnit = {
  amount: { currency_code: "USD", value: "25.00" },
  custom_id: "passport.v1.abc",
  items: unit.items,
};

async function paidOrder(s: ReturnType<typeof setup>) {
  const order = await s.paypal.orders.create(
    { intent: "CAPTURE", purchase_units: [{ amount: usd(2500), custom_id: "passport.v1.abc" }] },
    { requestId: "o1" },
  );
  s.mock.approveOrder(order.id);
  const done = await s.paypal.orders.capture(order.id, { requestId: "c1" });
  const cap = done.purchase_units?.[0]?.payments?.captures?.[0];
  if (!cap) throw new Error("no capture");
  return { order, cap };
}

describe("orders", () => {
  it("creates, approves, captures; custom_id and items.upc survive", async () => {
    const s = setup();
    const created = await s.raw("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [rawUnit],
    });
    expect(created.status).toBe(201);
    expect(created.json.status).toBe("CREATED");
    const u = created.json.purchase_units[0];
    expect(u.custom_id).toBe("passport.v1.abc");
    expect(u.items[0].upc).toEqual({ type: "UPC-A", code: "012345678905" });
    expect(validateResponse(ORDERS, "POST", "/v2/checkout/orders", created.json)).toEqual([]);

    const id = created.json.id as string;
    expect(
      (await s.raw("POST", `/v2/checkout/orders/${id}/capture`, {})).json.details[0].issue,
    ).toBe("ORDER_NOT_APPROVED");
    s.mock.approveOrder(id);
    expect((await s.raw("GET", `/v2/checkout/orders/${id}`)).json.status).toBe("APPROVED");
    const cap = await s.raw("POST", `/v2/checkout/orders/${id}/capture`, {});
    expect(cap.status).toBe(201);
    expect(cap.json.status).toBe("COMPLETED");
    expect(validateResponse(ORDERS, "POST", "/v2/checkout/orders/{id}/capture", cap.json)).toEqual(
      [],
    );
    const c = cap.json.purchase_units[0].payments.captures[0];
    expect(c.custom_id).toBe("passport.v1.abc");
    expect(c.seller_receivable_breakdown.net_amount.value).toBe("23.97");
    expect(
      (await s.raw("POST", `/v2/checkout/orders/${id}/capture`, {})).json.details[0].issue,
    ).toBe("ORDER_ALREADY_CAPTURED");
  });

  it("works through the typed client (amounts parse to Money)", async () => {
    const s = setup();
    const { cap } = await paidOrder(s);
    expect(cap.amount).toEqual(usd(2500));
    expect(cap.custom_id).toBe("passport.v1.abc");
  });

  it("rejects a bad body and an unauthenticated call", async () => {
    const s = setup();
    expect((await s.raw("POST", "/v2/checkout/orders", { intent: "CAPTURE" })).status).toBe(422);
    const res = await s.mock.fetch(`${MOCK_API_BASE}/v2/checkout/orders/x`);
    expect(res.status).toBe(401);
    expect((await s.raw("GET", "/v2/checkout/orders/nope")).status).toBe(404);
  });

  it("replays the original response for the same PayPal-Request-Id", async () => {
    const s = setup();
    const body = { intent: "CAPTURE", purchase_units: [rawUnit] };
    const a = await s.raw("POST", "/v2/checkout/orders", body, "same");
    const b = await s.raw("POST", "/v2/checkout/orders", body, "same");
    const c = await s.raw("POST", "/v2/checkout/orders", body, "other");
    expect(b.json.id).toBe(a.json.id);
    expect(c.json.id).not.toBe(a.json.id);
    expect(s.mock.state.orders.size).toBe(2);
  });
});

describe("refunds", () => {
  it("partial then full refund, with status transitions and over-refund refusal", async () => {
    const s = setup();
    const { cap } = await paidOrder(s);
    const p = `/v2/payments/captures/${cap.id}/refund`;

    const r1 = await s.raw("POST", p, { amount: { currency_code: "USD", value: "10.00" } }, "r1");
    expect(r1.status).toBe(201);
    expect(
      validateResponse(PAYMENTS, "POST", "/v2/payments/captures/{capture_id}/refund", r1.json),
    ).toEqual([]);
    const got = await s.raw("GET", `/v2/payments/captures/${cap.id}`);
    expect(got.json.status).toBe("PARTIALLY_REFUNDED");
    expect(
      validateResponse(PAYMENTS, "GET", "/v2/payments/captures/{capture_id}", got.json),
    ).toEqual([]);

    const tooMuch = await s.raw(
      "POST",
      p,
      { amount: { currency_code: "USD", value: "15.01" } },
      "r2",
    );
    expect(tooMuch.json.details[0].issue).toBe("REFUND_AMOUNT_EXCEEDED");

    const full = await s.raw("POST", p, {}, "r3");
    expect(full.json.amount.value).toBe("15.00");
    expect((await s.raw("GET", `/v2/payments/captures/${cap.id}`)).json.status).toBe("REFUNDED");
    expect((await s.raw("POST", p, {}, "r4")).json.details[0].issue).toBe("CAPTURE_FULLY_REFUNDED");
  });

  it("refund replay does not refund twice", async () => {
    const s = setup();
    const { cap } = await paidOrder(s);
    const p = `/v2/payments/captures/${cap.id}/refund`;
    const body = { amount: { currency_code: "USD", value: "5.00" } };
    await s.raw("POST", p, body, "same");
    await s.raw("POST", p, body, "same");
    expect(s.mock.state.refunds.size).toBe(1);
  });
});

describe("payouts", () => {
  const batch = (id: string) => ({
    sender_batch_header: { sender_batch_id: id, email_subject: "Creator payout" },
    items: [
      {
        recipient_type: "EMAIL",
        receiver: "creator@example.com",
        amount: { currency: "USD", value: "12.50" },
        sender_item_id: "i1",
      },
    ],
  });

  it("creates PENDING, settles to SUCCESS, spec-valid at each step", async () => {
    const s = setup();
    const created = await s.raw("POST", "/v1/payments/payouts", batch("b1"), "rq1");
    expect(created.status).toBe(201);
    expect(created.json.batch_header.batch_status).toBe("PENDING");
    expect(validateResponse(PAYOUTS, "POST", "/v1/payments/payouts", created.json)).toEqual([]);
    const id = created.json.batch_header.payout_batch_id as string;

    s.mock.settlePayouts(id);
    const got = await s.raw("GET", `/v1/payments/payouts/${id}`);
    expect(got.json.batch_header.batch_status).toBe("SUCCESS");
    expect(got.json.items[0].transaction_status).toBe("SUCCESS");
    expect(validateResponse(PAYOUTS, "GET", "/v1/payments/payouts/{id}", got.json)).toEqual([]);
    const item = await s.raw(
      "GET",
      `/v1/payments/payouts-item/${got.json.items[0].payout_item_id}`,
    );
    expect(
      validateResponse(PAYOUTS, "GET", "/v1/payments/payouts-item/{payout_item_id}", item.json),
    ).toEqual([]);
  });

  it("is idempotent on request id and refuses a reused sender_batch_id", async () => {
    const s = setup();
    const a = await s.raw("POST", "/v1/payments/payouts", batch("b1"), "rq1");
    const replay = await s.raw("POST", "/v1/payments/payouts", batch("b1"), "rq1");
    expect(replay.json.batch_header.payout_batch_id).toBe(a.json.batch_header.payout_batch_id);
    const dup = await s.raw("POST", "/v1/payments/payouts", batch("b1"), "rq2");
    expect(dup.status).toBe(400);
    expect(dup.json.name).toBe("USER_BUSINESS_ERROR");
    expect(s.mock.state.batches.size).toBe(1);
  });

  it("validates input", async () => {
    const s = setup();
    expect((await s.raw("POST", "/v1/payments/payouts", { items: [] })).status).toBe(400);
  });

  it("autoSettlePayouts settles after creation", async () => {
    const s = setup({ autoSettlePayouts: true });
    const created = await s.paypal.payouts.createBatch(
      {
        sender_batch_header: { sender_batch_id: "auto" },
        items: [{ receiver: "c@example.com", amount: usd(1250) }],
      },
      { requestId: "a" },
    );
    await Promise.resolve();
    const b = await s.paypal.payouts.getBatch(created.batch_header.payout_batch_id);
    expect(b.batch_header.batch_status).toBe("SUCCESS");
    expect(b.items[0]?.payout_item.amount).toEqual(usd(1250));
  });
});

describe("webhooks", () => {
  it("emits the order, capture, refund, dispute and payout events, all parseable and signed", async () => {
    const s = setup();
    const { cap } = await paidOrder(s);
    await s.paypal.captures.refund(cap.id, { amount: usd(1000) }, { requestId: "rf" });
    s.mock.openDispute(cap.id);
    await s.paypal.payouts.createBatch(
      {
        sender_batch_header: { sender_batch_id: "w1" },
        items: [{ receiver: "c@example.com", amount: usd(500) }],
      },
      { requestId: "p" },
    );
    s.mock.settlePayouts();
    await s.mock.flush();

    const types = s.deliveries.map((d) => d.event.event_type);
    expect(types).toEqual([
      "CHECKOUT.ORDER.APPROVED",
      "PAYMENT.CAPTURE.COMPLETED",
      "PAYMENT.CAPTURE.REFUNDED",
      "CUSTOMER.DISPUTE.CREATED",
      "PAYMENT.PAYOUTSBATCH.PROCESSING",
      "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      "PAYMENT.PAYOUTSBATCH.SUCCESS",
    ]);

    for (const d of s.deliveries) {
      const v = await verifyWebhookSelf({
        env: "sandbox",
        webhookId: s.mock.webhookId,
        headers: d.headers,
        rawBody: d.rawBody,
        fetch: s.mock.fetch,
        now: () => Date.parse("2026-11-05T10:00:00Z"),
      });
      expect(v, d.event.event_type).toEqual({ ok: true });
      const parsed = WebhookEvent.safeParse(d.event);
      if (d.event.event_type !== "CUSTOMER.DISPUTE.CREATED")
        expect(parsed.success, d.event.event_type).toBe(true);
    }
    const refunded = s.deliveries[2]?.event.resource as { amount: { value: string } };
    expect(refunded.amount.value).toBe("10.00");
    const dispute = s.deliveries[3]?.event.resource as {
      disputed_transactions: { seller_transaction_id: string; custom?: string }[];
    };
    expect(dispute.disputed_transactions[0]).toMatchObject({
      seller_transaction_id: cap.id,
      custom: "passport.v1.abc",
    });
  });

  it("POSTs signed events to a registered callback URL", async () => {
    const calls: { url: string; body: string; sig?: string | null }[] = [];
    const s = setup({
      deliverFetch: (async (u: string, init: RequestInit) => {
        calls.push({
          url: u,
          body: String(init.body),
          sig: new Headers(init.headers).get("paypal-transmission-sig"),
        });
        return new Response("ok");
      }) as typeof fetch,
    });
    s.mock.registerWebhook("http://localhost:8788/webhooks/paypal");
    await paidOrder(s);
    await s.mock.flush();
    expect(calls.map((c) => JSON.parse(c.body).event_type)).toEqual([
      "CHECKOUT.ORDER.APPROVED",
      "PAYMENT.CAPTURE.COMPLETED",
    ]);
    expect(calls[0]?.url).toBe("http://localhost:8788/webhooks/paypal");
    expect(calls[0]?.sig).toBeTruthy();
  });

  it("records a failed delivery without breaking the API call", async () => {
    const s = setup({
      deliverFetch: (async () => new Response("no", { status: 500 })) as typeof fetch,
    });
    s.mock.registerWebhook("http://localhost:1/x");
    await paidOrder(s);
    await s.mock.flush();
    expect(s.mock.failedDeliveries.length).toBe(2);
  });
});

describe("PAYPAL_MODE toggle", () => {
  it("defaults to simulated and runs offline", async () => {
    const { mode, paypal, mock } = createPayPalFromEnv({});
    expect(mode).toBe("simulated");
    const o = await paypal.orders.create(
      { intent: "CAPTURE", purchase_units: [{ amount: usd(100) }] },
      { requestId: "x" },
    );
    expect(mock?.state.orders.has(o.id)).toBe(true);
  });

  it("sandbox needs credentials and builds a real client with no mock", () => {
    expect(() => createPayPalFromEnv({ PAYPAL_MODE: "sandbox" })).toThrow(/PAYPAL_CLIENT_ID/);
    const r = createPayPalFromEnv({
      PAYPAL_MODE: "sandbox",
      PAYPAL_CLIENT_ID: "a",
      PAYPAL_CLIENT_SECRET: "b",
    });
    expect(r.mode).toBe("sandbox");
    expect(r.mock).toBeUndefined();
  });

  it("rejects unknown modes", () => {
    expect(() => createPayPalFromEnv({ PAYPAL_MODE: "live" })).toThrow(/simulated/);
  });
});
