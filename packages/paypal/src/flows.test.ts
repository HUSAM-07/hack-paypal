import { describe, expect, it } from "vitest";
import { PayPalError } from "./errors";
import {
  captureAll,
  chargeMandate,
  completeMandateSetup,
  groupAuthorizeAll,
  idempotencyKey,
  requestP2P,
  sendP2P,
  startMandateSetup,
  voidAll,
} from "./flows";
import { fakeFetch, testClient } from "./testing/fake-fetch";
import * as fx from "./testing/fixtures";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const ORDERS = "POST /v2/checkout/orders";

describe("idempotencyKey", () => {
  it("joins short parts and hashes long ones deterministically", async () => {
    expect(await idempotencyKey("pact_1", "run_1", "u1")).toBe("pact_1:run_1:u1");
    const long = await idempotencyKey("p".repeat(100), "run", "user");
    expect(long).toMatch(/^h:[0-9a-f]{64}$/);
    expect(await idempotencyKey("p".repeat(100), "run", "user")).toBe(long);
    expect(await idempotencyKey("p".repeat(100), "run", "other")).not.toBe(long);
  });
});

describe("mandate setup", () => {
  it("start creates a MERCHANT/CONSUMER setup token and returns the approve link", async () => {
    const fake = fakeFetch().on("POST /v3/vault/setup-tokens", {
      status: 201,
      body: fx.setupToken,
    });
    const res = await startMandateSetup(testClient(fake), {
      returnUrl: "https://pact.app/ok",
      cancelUrl: "https://pact.app/cancel",
      customerId: "customer_4029352050",
      requestId: "mandate:m1:setup",
    });
    expect(res).toEqual({
      setupTokenId: "5C991763VB2781612",
      status: "PAYER_ACTION_REQUIRED",
      approveUrl: expect.stringContaining("agreements/approve"),
    });
    const call = fake.last("POST /v3/vault/setup-tokens");
    expect(call.headers.get("paypal-request-id")).toBe("mandate:m1:setup");
    expect(call.body).toMatchObject({
      payment_source: {
        paypal: {
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          experience_context: {
            vault_instruction: "ON_PAYER_APPROVAL",
            return_url: "https://pact.app/ok",
          },
        },
      },
      customer: { id: "customer_4029352050" },
    });
  });

  it("complete exchanges the setup token for vault + customer ids", async () => {
    const fake = fakeFetch().on("POST /v3/vault/payment-tokens", {
      status: 201,
      body: fx.paymentToken,
    });
    expect(
      await completeMandateSetup(testClient(fake), { setupTokenId: "ST", requestId: "k" }),
    ).toEqual({
      vaultId: "8kk8451t",
      customerId: "customer_4029352050",
      payerEmail: "buyer@example.com",
      payerId: "QYR5Z8XDVJNXQ",
    });
  });

  it("complete refuses a token without a customer", async () => {
    const fake = fakeFetch().on("POST /v3/vault/payment-tokens", {
      status: 201,
      body: { id: "x" },
    });
    await expect(
      completeMandateSetup(testClient(fake), { setupTokenId: "ST", requestId: "k" }),
    ).rejects.toThrow(/customer/);
  });
});

describe("chargeMandate", () => {
  const base = {
    vaultId: "8kk8451t",
    amount: usd(2500),
    customId: "pact_1",
    requestId: "pact_1:run_1:u1",
  };

  it("returns succeeded when the order completes on create, with MIT stored_credential", async () => {
    const fake = fakeFetch().on(ORDERS, { status: 201, body: fx.orderCompletedVault });
    const res = await chargeMandate(testClient(fake), base);
    expect(res.outcome).toBe("succeeded");
    expect(res.capture?.amount).toEqual(usd(2500));
    expect(fake.last(ORDERS).body).toMatchObject({
      intent: "CAPTURE",
      payment_source: {
        paypal: {
          vault_id: "8kk8451t",
          stored_credential: {
            payment_initiator: "MERCHANT",
            usage: "SUBSEQUENT",
            usage_pattern: "UNSCHEDULED_POSTPAID",
          },
        },
      },
    });
    expect(fake.calls.some((c) => c.key.endsWith("/capture"))).toBe(false);
  });

  it("captures when the order comes back APPROVED, with a derived key", async () => {
    const fake = fakeFetch()
      .on(ORDERS, { status: 201, body: fx.orderApproved })
      .on(`POST /v2/checkout/orders/${fx.orderApproved.id}/capture`, {
        status: 201,
        body: fx.orderCompletedVault,
      });
    const res = await chargeMandate(testClient(fake), { ...base, storedCredential: false });
    expect(res.outcome).toBe("succeeded");
    expect(
      fake
        .last(`POST /v2/checkout/orders/${fx.orderApproved.id}/capture`)
        .headers.get("paypal-request-id"),
    ).toBe("pact_1:run_1:u1:capture");
    const body = fake.last(ORDERS).body as { payment_source: { paypal: Record<string, unknown> } };
    expect(body.payment_source.paypal.stored_credential).toBeUndefined();
  });

  it("reports payer_action_required and declined captures", async () => {
    const fake = fakeFetch().on(
      ORDERS,
      { status: 201, body: fx.orderPayerActionRequired },
      {
        status: 201,
        body: {
          ...fx.orderCompletedVault,
          purchase_units: [{ payments: { captures: [{ ...fx.capture, status: "DECLINED" }] } }],
        },
      },
    );
    const pp = testClient(fake);
    expect((await chargeMandate(pp, base)).outcome).toBe("payer_action_required");
    expect((await chargeMandate(pp, base)).outcome).toBe("failed");
  });

  it("passes mock declines through and surfaces them as PayPalError", async () => {
    const fake = fakeFetch().on(ORDERS, { status: 422, body: fx.error422 });
    const err = await chargeMandate(testClient(fake), {
      ...base,
      mock: "INSTRUMENT_DECLINED",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.issues).toEqual(["INSTRUMENT_DECLINED"]);
    expect(JSON.parse(fake.last(ORDERS).headers.get("paypal-mock-response") ?? "")).toEqual({
      mock_application_codes: "INSTRUMENT_DECLINED",
    });
  });
});

describe("group split", () => {
  /** Routes order creation by the vault id in the body so members get distinct results. */
  function groupFake(declineVault?: string) {
    return fakeFetch()
      .on(ORDERS, (req) => {
        const vault = (req.body as { payment_source: { paypal: { vault_id: string } } })
          .payment_source.paypal.vault_id;
        if (vault === declineVault) return { status: 422, body: fx.error422 };
        return { status: 201, body: fx.orderAuthorized(`ORDER_${vault}`, `AUTH_${vault}`) };
      })
      .on("POST /v2/checkout/orders/ORDER_APPROVED/authorize", {
        status: 201,
        body: fx.orderAuthorized("ORDER_APPROVED", "AUTH_APPROVED"),
      })
      .on("POST /v2/payments/authorizations/AUTH_v1/void", { status: 204 })
      .on("POST /v2/payments/authorizations/AUTH_v2/void", { status: 422, body: fx.errorVoided })
      .on("POST /v2/payments/authorizations/AUTH_APPROVED/void", { status: 204 })
      .on("POST /v2/payments/authorizations/AUTH_v1/capture", {
        status: 201,
        body: { ...fx.capture, id: "CAP1" },
      })
      .on("POST /v2/payments/authorizations/AUTH_v2/capture", { status: 422, body: fx.error422 });
  }

  const members = [
    { memberId: "u1", amount: usd(1000), source: { kind: "vault" as const, vaultId: "v1" } },
    { memberId: "u2", amount: usd(1000), source: { kind: "vault" as const, vaultId: "v2" } },
    {
      memberId: "u3",
      amount: usd(1000),
      source: { kind: "approved_order" as const, orderId: "ORDER_APPROVED" },
    },
  ];

  it("authorizes everyone and returns holds", async () => {
    const fake = groupFake();
    const res = await groupAuthorizeAll(testClient(fake), {
      customId: "pact_1",
      members,
      requestIdPrefix: "pact_1:run_1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.holds.map((h) => [h.memberId, h.authorizationId])).toEqual([
      ["u1", "AUTH_v1"],
      ["u2", "AUTH_v2"],
      ["u3", "AUTH_APPROVED"],
    ]);
    expect(res.holds[0]?.amount).toEqual(usd(1000));
    const intents = fake.to(ORDERS).map((c) => (c.body as { intent: string }).intent);
    expect(intents).toEqual(["AUTHORIZE", "AUTHORIZE"]);
    expect(fake.calls.some((c) => c.key.endsWith("/void"))).toBe(false);
  });

  it("voids the successful holds when any member fails", async () => {
    const fake = groupFake("v2");
    const res = await groupAuthorizeAll(testClient(fake), {
      customId: "pact_1",
      members,
      requestIdPrefix: "pact_1:run_1",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failures).toEqual([
      {
        memberId: "u2",
        reason: "UNPROCESSABLE_ENTITY",
        issues: ["INSTRUMENT_DECLINED"],
        debugId: "f2b3c4d5e6f7a",
      },
    ]);
    expect(res.released.voided.sort()).toEqual(["u1", "u3"]);
    expect(
      fake.last("POST /v2/payments/authorizations/AUTH_v1/void").headers.get("paypal-request-id"),
    ).toBe("pact_1:run_1:u1:void");
  });

  it("voidAll treats already-voided as released", async () => {
    const res = await voidAll(testClient(groupFake()), {
      holds: [
        { memberId: "u1", authorizationId: "AUTH_v1" },
        { memberId: "u2", authorizationId: "AUTH_v2" },
      ],
      requestIdPrefix: "p",
    });
    expect(res).toEqual({ ok: true, voided: ["u1", "u2"], failed: [] });
  });

  it("voidAll reports real failures", async () => {
    const fake = fakeFetch().on("POST /v2/payments/authorizations/A/void", {
      status: 422,
      body: fx.error422,
    });
    const res = await voidAll(testClient(fake), {
      holds: [{ memberId: "u1", authorizationId: "A" }],
      requestIdPrefix: "p",
    });
    expect(res.ok).toBe(false);
    expect(res.failed[0]?.issues).toEqual(["INSTRUMENT_DECLINED"]);
  });

  it("captureAll captures each hold and reports partial failure", async () => {
    const fake = groupFake();
    const res = await captureAll(testClient(fake), {
      holds: [
        { memberId: "u1", authorizationId: "AUTH_v1", amount: usd(900) },
        { memberId: "u2", authorizationId: "AUTH_v2" },
      ],
      requestIdPrefix: "pact_1:run_1",
    });
    expect(res.ok).toBe(false);
    expect(res.captured).toEqual([
      { memberId: "u1", captureId: "CAP1", status: "COMPLETED", amount: usd(2500) },
    ]);
    expect(res.failed.map((f) => f.memberId)).toEqual(["u2"]);
    expect(fake.last("POST /v2/payments/authorizations/AUTH_v1/capture").body).toEqual({
      final_capture: true,
      amount: { currency_code: "USD", value: "9.00" },
    });
  });
});

describe("P2P", () => {
  it("sendP2P creates a one-item payout batch", async () => {
    const fake = fakeFetch().on("POST /v1/payments/payouts", {
      status: 201,
      body: fx.payoutBatchCreated,
    });
    const res = await sendP2P(testClient(fake), {
      receiver: "friend@example.com",
      amount: usd(1250),
      wallet: "VENMO",
      senderBatchId: "pact_1:run_1",
      note: "Dinner",
      requestId: "pact_1:run_1:payout",
    });
    expect(res).toEqual({ payoutBatchId: "5UXD2E8A7EBQJ", batchStatus: "PENDING" });
    expect(fake.last("POST /v1/payments/payouts").body).toEqual({
      sender_batch_header: { sender_batch_id: "pact_1:run_1" },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: "friend@example.com",
          recipient_wallet: "VENMO",
          note: "Dinner",
          amount: { currency: "USD", value: "12.50" },
        },
      ],
    });
  });

  it("requestP2P creates and sends an invoice", async () => {
    const ID = fx.invoiceDraft.id;
    const fake = fakeFetch()
      .on("POST /v2/invoicing/invoices", { status: 201, body: fx.invoiceDraft })
      .on(`POST /v2/invoicing/invoices/${ID}/send`, { status: 202 });
    const res = await requestP2P(testClient(fake), {
      payerEmail: "friend@example.com",
      amount: usd(3000),
      itemName: "Dinner share",
      allowPartial: true,
      requestId: "pact_1:req",
    });
    expect(res).toEqual({
      invoiceId: ID,
      status: "SENT",
      payerUrl: fx.invoiceDraft.detail.metadata.recipient_view_url,
    });
    expect(
      fake.last(`POST /v2/invoicing/invoices/${ID}/send`).headers.get("paypal-request-id"),
    ).toBe("pact_1:req:send");
    expect(fake.last("POST /v2/invoicing/invoices").body).toMatchObject({
      detail: { currency_code: "USD" },
      items: [
        {
          name: "Dinner share",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "30.00" },
        },
      ],
      configuration: { partial_payment: { allow_partial_payment: true } },
    });
  });
});
