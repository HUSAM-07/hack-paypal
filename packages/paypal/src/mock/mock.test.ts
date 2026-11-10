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
  it("a restarted mock with an id offset never repeats an earlier instance's ids", async () => {
    const first = await paidOrder(setup());
    const again = await paidOrder(setup());
    expect(again.cap.id).toBe(first.cap.id); // same counter, same ids
    const later = await paidOrder(setup({ idOffset: 1_794_000_000_000 }));
    expect(later.order.id).not.toBe(first.order.id);
    expect(later.cap.id).not.toBe(first.cap.id);
    expect(later.cap.id).toHaveLength(first.cap.id.length);
  });

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

  it("pays a named payee from a vaulted wallet in one call, order event before capture", async () => {
    const s = setup();
    const wallet = s.mock.vaultWallet({ email: "buyer@agent.test" });
    const payee = { merchant_id: "SELLERLUMEN01" };
    const created = await s.raw("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{ ...rawUnit, reference_id: "lumen", payee }],
      payment_source: { paypal: { vault_id: wallet.id } },
    });
    expect(created.status).toBe(201);
    expect(created.json.status).toBe("COMPLETED");
    expect(validateResponse(ORDERS, "POST", "/v2/checkout/orders", created.json)).toEqual([]);
    const u = created.json.purchase_units[0];
    expect(u.payee).toEqual(payee);
    expect(u.payments.captures[0].custom_id).toBe("passport.v1.abc");
    expect(created.json.payment_source.paypal.email_address).toBe("buyer@agent.test");
    const [cap] = [...s.mock.state.captures.values()];
    expect(cap?.payee).toEqual(payee);
    await s.mock.flush();
    expect(s.deliveries.map((d) => d.event.event_type)).toEqual([
      "CHECKOUT.ORDER.COMPLETED",
      "PAYMENT.CAPTURE.COMPLETED",
    ]);
    expect(WebhookEvent.safeParse(s.deliveries[0]?.event).success).toBe(true);
  });

  it("rejects an unknown vault_id and a payee without an account", async () => {
    const s = setup();
    const bad = await s.raw("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [rawUnit],
      payment_source: { paypal: { vault_id: "nope" } },
    });
    expect(bad.json.details[0].issue).toBe("INVALID_PAYMENT_TOKEN");
    const noPayee = await s.raw("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{ ...rawUnit, payee: {} }],
    });
    expect(noPayee.status).toBe(422);
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

  it("resolves a dispute with a CUSTOMER.DISPUTE.RESOLVED carrying the outcome", async () => {
    const s = setup();
    const { cap } = await paidOrder(s);
    const d = s.mock.openDispute(cap.id);
    s.mock.resolveDispute(d.dispute_id, "RESOLVED_SELLER_FAVOUR");
    s.mock.resolveDispute(d.dispute_id, "RESOLVED_BUYER_FAVOUR"); // already decided: no-op
    await s.mock.flush();
    const disputes = s.deliveries.filter((x) => x.event.event_type.startsWith("CUSTOMER.DISPUTE"));
    expect(disputes.map((x) => x.event.event_type)).toEqual([
      "CUSTOMER.DISPUTE.CREATED",
      "CUSTOMER.DISPUTE.RESOLVED",
    ]);
    const resolved = disputes[1]?.event.resource as Record<string, unknown>;
    expect(resolved).toMatchObject({
      dispute_id: d.dispute_id,
      status: "RESOLVED",
      dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" },
      disputed_transactions: [{ seller_transaction_id: cap.id }],
    });
    // Signed like every other event (the cert is cached per URL, so verification itself is
    // covered by the test above, which owns the first certificate).
    expect(Object.keys((disputes[1] as WebhookDelivery).headers)).toContain(
      "paypal-transmission-sig",
    );
    expect(s.mock.state.disputes.get(d.dispute_id)?.outcome).toBe("RESOLVED_SELLER_FAVOUR");
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

describe("Log in with PayPal", () => {
  it("exchanges a code for a user token and returns a stable payer id", async () => {
    const { paypal } = createPayPalFromEnv({});
    const tokens = await paypal.identity.exchangeCode("sim_code_123", {
      redirectUri: "https://x.test/cb",
    });
    const info = await paypal.identity.userinfo(tokens.access_token);
    expect(info.payer_id).toMatch(/^[A-Z2-9]{13}$/);
    const again = await paypal.identity.userinfo(
      (await paypal.identity.exchangeCode("sim_code_123")).access_token,
    );
    expect(again.payer_id).toBe(info.payer_id);
    const other = await paypal.identity.exchangeCode("sim_code_456");
    expect((await paypal.identity.userinfo(other.access_token)).payer_id).not.toBe(info.payer_id);
  });

  it("rejects a malformed code and an app token at userinfo", async () => {
    const { paypal } = createPayPalFromEnv({});
    await expect(paypal.identity.exchangeCode("x")).rejects.toThrow();
    await expect(paypal.identity.userinfo("A21AAmock-1")).rejects.toThrow();
  });
});

describe("ids", () => {
  it("start from idOffset, so a recreated mock never repeats an old id", () => {
    const first = createMockPayPal().vaultWallet().id;
    expect(createMockPayPal().vaultWallet().id).toBe(first);
    const fresh = createMockPayPal({ idOffset: 1_000_000 }).vaultWallet().id;
    expect(fresh).not.toBe(first);
    expect(fresh.startsWith("VT-")).toBe(true);
  });
});

describe("invoicing", () => {
  const INVOICING = "invoicing_v2";
  const statement = (number: string) => ({
    detail: { currency_code: "USD", invoice_number: number, note: "statement" },
    items: [
      {
        name: "Commission credited",
        quantity: "1",
        unit_amount: usd(39164),
        discount: { amount: usd(768) },
      },
    ],
  });

  it("creates, sends and marks paid a statement; spec-valid at each step", async () => {
    const s = setup();
    const inv = await s.paypal.invoicing.create(statement("CITED-T1"), { requestId: "c1" });
    expect(inv.status).toBe("DRAFT");
    expect(inv.amount).toEqual(usd(38396));
    const draft = await s.raw("GET", `/v2/invoicing/invoices/${inv.id}`);
    expect(
      validateResponse(INVOICING, "GET", "/v2/invoicing/invoices/{invoice_id}", draft.json),
    ).toEqual([]);

    await s.paypal.invoicing.send(inv.id, { send_to_recipient: false }, { requestId: "s1" });
    await expect(
      s.paypal.invoicing.recordPayment(
        inv.id,
        { method: "OTHER", amount: usd(38397) },
        { requestId: "p0" },
      ),
    ).rejects.toThrow();
    const pay = await s.paypal.invoicing.recordPayment(
      inv.id,
      { method: "OTHER", amount: usd(38396), payment_date: "2026-12-05" },
      { requestId: "p1" },
    );
    expect(pay.paymentId).toMatch(/^EXTR-/);
    // A replay is answered from the idempotency store: no second payment.
    await s.paypal.invoicing.recordPayment(
      inv.id,
      { method: "OTHER", amount: usd(38396) },
      { requestId: "p1" },
    );

    const paid = await s.paypal.invoicing.get(inv.id);
    expect(paid.status).toBe("MARKED_AS_PAID");
    expect(paid.due_amount).toEqual(usd(0));
    expect(paid.payments?.paid_amount).toEqual(usd(38396));
    const got = await s.raw("GET", `/v2/invoicing/invoices/${inv.id}`);
    expect(
      validateResponse(INVOICING, "GET", "/v2/invoicing/invoices/{invoice_id}", got.json),
    ).toEqual([]);
  });

  it("refuses a duplicate invoice number, a discount over the line, and paying a draft", async () => {
    const s = setup();
    const inv = await s.paypal.invoicing.create(statement("CITED-T2"), { requestId: "c1" });
    await expect(
      s.paypal.invoicing.create(statement("CITED-T2"), { requestId: "c2" }),
    ).rejects.toThrow();
    const bad = statement("CITED-T3");
    bad.items[0] = { ...bad.items[0], discount: { amount: usd(40000) } } as (typeof bad.items)[0];
    await expect(s.paypal.invoicing.create(bad, { requestId: "c3" })).rejects.toThrow();
    await expect(
      s.paypal.invoicing.recordPayment(inv.id, { method: "OTHER" }, { requestId: "p1" }),
    ).rejects.toThrow();
  });
});
