import { describe, expect, it } from "vitest";
import { primaryEmail } from "./identity";
import { invoicePayerUrl } from "./invoicing";
import { orderApproveUrl } from "./orders";
import { fakeFetch, testClient } from "./testing/fake-fetch";
import * as fx from "./testing/fixtures";
import { setupTokenApproveUrl } from "./vault";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const rid = { requestId: "req-1" };

describe("orders", () => {
  it("create serializes Money, payee and vault payment source", async () => {
    const fake = fakeFetch().on("POST /v2/checkout/orders", {
      status: 201,
      body: fx.orderCompletedVault,
    });
    const order = await testClient(fake).orders.create(
      {
        intent: "CAPTURE",
        purchase_units: [
          { amount: usd(2500), custom_id: "pact_1", payee: { email_address: "shop@example.com" } },
        ],
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
      },
      rid,
    );
    expect(fake.last("POST /v2/checkout/orders").body).toEqual({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: "pact_1",
          payee: { email_address: "shop@example.com" },
          amount: { currency_code: "USD", value: "25.00" },
        },
      ],
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
    expect(order.status).toBe("COMPLETED");
    const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
    expect(cap?.amount).toEqual(usd(2500));
    expect(cap?.seller_receivable_breakdown?.paypal_fee).toEqual(usd(122));
    expect(order.payment_source?.paypal?.attributes?.vault?.customer?.id).toBe("wxj1234");
  });

  it("get / authorize / capture hit the right paths", async () => {
    const id = "5O190127TN364715T";
    const fake = fakeFetch()
      .on(`GET /v2/checkout/orders/${id}`, { body: fx.orderCreated })
      .on(`POST /v2/checkout/orders/${id}/authorize`, {
        status: 201,
        body: fx.orderAuthorized(id, "AUTH1"),
      })
      .on(`POST /v2/checkout/orders/${id}/capture`, { status: 201, body: fx.orderCompletedVault });
    const pp = testClient(fake);
    const got = await pp.orders.get(id);
    expect(orderApproveUrl(got)).toContain("checkoutnow");
    const authed = await pp.orders.authorize(id, rid);
    expect(authed.purchase_units?.[0]?.payments?.authorizations?.[0]?.id).toBe("AUTH1");
    await pp.orders.capture(id, rid);
    expect(fake.last(`POST /v2/checkout/orders/${id}/capture`).body).toEqual({});
  });

  it("prefers the payer-action link", () => {
    expect(
      orderApproveUrl({ ...fx.orderPayerActionRequired, status: "PAYER_ACTION_REQUIRED" }),
    ).toContain("checkoutnow");
  });
});

describe("authorizations and captures", () => {
  const A = "0VF52814937998046";
  it("partial capture sends amount and final_capture:false", async () => {
    const fake = fakeFetch().on(`POST /v2/payments/authorizations/${A}/capture`, {
      status: 201,
      body: {
        ...fx.capture,
        amount: { currency_code: "USD", value: "4.00" },
        final_capture: false,
      },
    });
    const cap = await testClient(fake).authorizations.capture(
      A,
      { amount: usd(400), final_capture: false },
      rid,
    );
    expect(fake.last(`POST /v2/payments/authorizations/${A}/capture`).body).toEqual({
      final_capture: false,
      amount: { currency_code: "USD", value: "4.00" },
    });
    expect(cap.amount).toEqual(usd(400));
  });

  it("full capture omits amount", async () => {
    const fake = fakeFetch().on(`POST /v2/payments/authorizations/${A}/capture`, {
      status: 201,
      body: fx.capture,
    });
    await testClient(fake).authorizations.capture(A, {}, rid);
    expect(fake.last(`POST /v2/payments/authorizations/${A}/capture`).body).toEqual({});
  });

  it("void handles 204 and 200", async () => {
    const fake = fakeFetch().on(
      `POST /v2/payments/authorizations/${A}/void`,
      { status: 204 },
      { body: { ...fx.authorization, status: "VOIDED" } },
    );
    const pp = testClient(fake);
    expect(await pp.authorizations.void(A, rid)).toBeNull();
    expect((await pp.authorizations.void(A, rid))?.status).toBe("VOIDED");
  });

  it("reauthorize and get", async () => {
    const fake = fakeFetch()
      .on(`POST /v2/payments/authorizations/${A}/reauthorize`, {
        status: 201,
        body: { ...fx.authorization, id: "NEW" },
      })
      .on(`GET /v2/payments/authorizations/${A}`, { body: fx.authorization });
    const pp = testClient(fake);
    expect((await pp.authorizations.reauthorize(A, { amount: usd(1000) }, rid)).id).toBe("NEW");
    expect(fake.last(`POST /v2/payments/authorizations/${A}/reauthorize`).body).toEqual({
      amount: { currency_code: "USD", value: "10.00" },
    });
    expect((await pp.authorizations.get(A)).expiration_time).toBe("2026-11-30T10:00:00Z");
  });

  it("refund (partial) and capture get", async () => {
    const C = "3C679366HH908993F";
    const fake = fakeFetch()
      .on(`POST /v2/payments/captures/${C}/refund`, { status: 201, body: fx.refund })
      .on(`GET /v2/payments/captures/${C}`, { body: fx.capture });
    const pp = testClient(fake);
    const r = await pp.captures.refund(C, { amount: usd(500), note_to_payer: "price drop" }, rid);
    expect(r.amount).toEqual(usd(500));
    expect(fake.last(`POST /v2/payments/captures/${C}/refund`).body).toEqual({
      note_to_payer: "price drop",
      amount: { currency_code: "USD", value: "5.00" },
    });
    expect((await pp.captures.get(C)).status).toBe("COMPLETED");
  });
});

describe("vault", () => {
  it("setup token → payment token → list → delete", async () => {
    const fake = fakeFetch()
      .on("POST /v3/vault/setup-tokens", { status: 201, body: fx.setupToken })
      .on("POST /v3/vault/payment-tokens", { status: 201, body: fx.paymentToken })
      .on("GET /v3/vault/payment-tokens", { body: fx.paymentTokenList })
      .on("GET /v3/vault/setup-tokens/5C991763VB2781612", {
        body: { ...fx.setupToken, status: "APPROVED" },
      })
      .on("DELETE /v3/vault/payment-tokens/8kk8451t", { status: 204 });
    const pp = testClient(fake);
    const st = await pp.vault.setupTokens.create(
      {
        payment_source: {
          paypal: {
            usage_type: "MERCHANT",
            experience_context: { return_url: "https://a/r", cancel_url: "https://a/c" },
          },
        },
      },
      rid,
    );
    expect(st.status).toBe("PAYER_ACTION_REQUIRED");
    expect(setupTokenApproveUrl(st)).toContain("agreements/approve");
    expect((await pp.vault.setupTokens.get(st.id)).status).toBe("APPROVED");

    const pt = await pp.vault.paymentTokens.create(st.id, rid);
    expect(fake.last("POST /v3/vault/payment-tokens").body).toEqual({
      payment_source: { token: { id: "5C991763VB2781612", type: "SETUP_TOKEN" } },
    });
    expect(pt.customer?.id).toBe("customer_4029352050");

    const list = await pp.vault.paymentTokens.list({
      customer_id: "customer_4029352050",
      page_size: 5,
    });
    expect(fake.last("GET /v3/vault/payment-tokens").url.search).toBe(
      "?customer_id=customer_4029352050&page_size=5",
    );
    expect(list.payment_tokens).toHaveLength(1);

    await pp.vault.paymentTokens.delete("8kk8451t", { requestId: "revoke" });
    expect(
      fake.last("DELETE /v3/vault/payment-tokens/8kk8451t").headers.get("paypal-request-id"),
    ).toBe("revoke");
  });
});

describe("payouts", () => {
  it("createBatch uses {currency,value}; get batch and item parse Money", async () => {
    const fake = fakeFetch()
      .on("POST /v1/payments/payouts", { status: 201, body: fx.payoutBatchCreated })
      .on("GET /v1/payments/payouts/5UXD2E8A7EBQJ", { body: fx.payoutBatch })
      .on("GET /v1/payments/payouts-item/8AELMXH8UB2P8", { body: fx.payoutItem });
    const pp = testClient(fake);
    const created = await pp.payouts.createBatch(
      {
        sender_batch_header: { sender_batch_id: "pact_1:run_1" },
        items: [
          {
            recipient_type: "EMAIL",
            receiver: "friend@example.com",
            amount: usd(1250),
            recipient_wallet: "VENMO",
          },
        ],
      },
      rid,
    );
    expect(fake.last("POST /v1/payments/payouts").body).toEqual({
      sender_batch_header: { sender_batch_id: "pact_1:run_1" },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: "friend@example.com",
          recipient_wallet: "VENMO",
          amount: { currency: "USD", value: "12.50" },
        },
      ],
    });
    expect(created.batch_header.batch_status).toBe("PENDING");
    const batch = await pp.payouts.getBatch("5UXD2E8A7EBQJ", { page_size: 10 });
    expect(batch.batch_header.fees).toEqual(usd(25));
    expect(batch.items[0]?.payout_item.amount).toEqual(usd(1250));
    const item = await pp.payouts.getItem("8AELMXH8UB2P8");
    expect(item.transaction_status).toBe("SUCCESS");
  });
});

describe("invoicing", () => {
  const ID = "INV2-Z56S-5LLA-Q52L-CPZ5";
  it("create, send, get, cancel", async () => {
    const fake = fakeFetch()
      .on("POST /v2/invoicing/invoices", { status: 201, body: fx.invoiceDraft })
      .on(`POST /v2/invoicing/invoices/${ID}/send`, { body: fx.invoiceSendResponse })
      .on(`GET /v2/invoicing/invoices/${ID}`, { body: fx.invoicePaid })
      .on(`POST /v2/invoicing/invoices/${ID}/cancel`, { status: 204 });
    const pp = testClient(fake);
    const inv = await pp.invoicing.create(
      {
        detail: { currency_code: "USD", note: "Dinner" },
        primary_recipients: [{ billing_info: { email_address: "friend@example.com" } }],
        items: [{ name: "Dinner share", quantity: "1", unit_amount: usd(3000) }],
        configuration: {
          partial_payment: { allow_partial_payment: true, minimum_amount_due: usd(1000) },
        },
      },
      rid,
    );
    const body = fake.last("POST /v2/invoicing/invoices").body as Record<string, unknown>;
    expect(body.items).toEqual([
      {
        name: "Dinner share",
        quantity: "1",
        unit_amount: { currency_code: "USD", value: "30.00" },
      },
    ]);
    expect(body.configuration).toEqual({
      partial_payment: {
        allow_partial_payment: true,
        minimum_amount_due: { currency_code: "USD", value: "10.00" },
      },
    });
    expect(inv.amount).toEqual(usd(3000));
    expect(invoicePayerUrl(inv)).toContain("/invoice/p/");

    expect(await pp.invoicing.send(ID, { send_to_recipient: true }, rid)).toEqual({
      payerUrl: fx.invoiceSendResponse.href,
    });
    const paid = await pp.invoicing.get(ID);
    expect(paid.status).toBe("PAID");
    expect(paid.payments?.paid_amount).toEqual(usd(3000));
    await pp.invoicing.cancel(ID, { note: "never mind" }, rid);
    expect(fake.to(`POST /v2/invoicing/invoices/${ID}/cancel`)).toHaveLength(1);
  });

  it("send returns null on 202", async () => {
    const fake = fakeFetch().on(`POST /v2/invoicing/invoices/${ID}/send`, { status: 202 });
    expect(await testClient(fake).invoicing.send(ID, {}, rid)).toBeNull();
  });
});

describe("identity and client token", () => {
  it("builds the authorize URL", () => {
    const url = new URL(
      testClient(fakeFetch()).identity.authorizeUrl({
        redirectUri: "https://pact.app/cb",
        state: "s1",
      }),
    );
    expect(url.origin).toBe("https://www.sandbox.paypal.com");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("state")).toBe("s1");
  });

  it("exchanges a code and fetches userinfo with the user token", async () => {
    const fake = fakeFetch()
      .on("POST /v1/oauth2/token", { body: fx.userTokens })
      .on("GET /v1/identity/oauth2/userinfo", { body: fx.userInfo });
    const pp = testClient(fake);
    const tokens = await pp.identity.exchangeCode("AUTH_CODE", {
      redirectUri: "https://pact.app/cb",
    });
    expect(fake.last("POST /v1/oauth2/token").body).toEqual({
      grant_type: "authorization_code",
      code: "AUTH_CODE",
      redirect_uri: "https://pact.app/cb",
    });
    const info = await pp.identity.userinfo(tokens.access_token);
    const call = fake.last("GET /v1/identity/oauth2/userinfo");
    expect(call.headers.get("authorization")).toBe("Bearer A23AAtest-user-access");
    expect(call.url.searchParams.get("schema")).toBe("paypalv1.1");
    expect(primaryEmail(info)).toBe("buyer@example.com");
    expect(info.payer_id).toBe("QYR5Z8XDVJNXQ");
  });

  it("mints a v6 client token with domains and vault claims", async () => {
    const fake = fakeFetch().on("POST /v1/oauth2/token", { body: fx.clientTokenResponse });
    const ct = await testClient(fake, { now: () => 1000 }).clientToken({
      domains: ["pact.app"],
      vaultId: "8kk8451t",
    });
    expect(ct).toEqual({ token: fx.clientTokenResponse.access_token, expiresAt: 1000 + 900_000 });
    const raw = fake.last("POST /v1/oauth2/token").rawBody ?? "";
    const params = new URLSearchParams(raw);
    expect(params.get("response_type")).toBe("client_token");
    expect(params.getAll("domains[]")).toEqual(["pact.app"]);
    expect(params.getAll("claims[]")).toEqual(["vault_id:8kk8451t"]);
  });
});
