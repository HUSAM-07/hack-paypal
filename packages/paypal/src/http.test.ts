import { describe, expect, it } from "vitest";
import { PayPalError, PayPalResponseError } from "./errors";
import type { RequestLog } from "./http";
import { memoryStore } from "./store";
import { fakeFetch, testClient } from "./testing/fake-fetch";
import { error422, errorOAuth, orderCompletedVault, tokenResponse } from "./testing/fixtures";

const ORDER = "GET /v2/checkout/orders/8AB12345CD678901E";
const CREATE = "POST /v2/checkout/orders";
const TOKEN = "POST /v1/oauth2/token";
const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const createInput = { intent: "CAPTURE" as const, purchase_units: [{ amount: usd(2500) }] };

describe("app token", () => {
  it("fetches with Basic client credentials and reuses it", async () => {
    const fake = fakeFetch().on(ORDER, { body: orderCompletedVault });
    const pp = testClient(fake);
    await pp.orders.get("8AB12345CD678901E");
    await pp.orders.get("8AB12345CD678901E");
    expect(fake.to(TOKEN)).toHaveLength(1);
    const tokenCall = fake.last(TOKEN);
    expect(tokenCall.headers.get("authorization")).toBe(
      `Basic ${btoa("test-client-id:test-client-secret")}`,
    );
    expect(tokenCall.body).toEqual({ grant_type: "client_credentials" });
    expect(fake.last(ORDER).headers.get("authorization")).toBe(
      `Bearer ${tokenResponse.access_token}`,
    );
  });

  it("refreshes inside the safety margin", async () => {
    let now = 1_000_000;
    const fake = fakeFetch()
      .on(TOKEN, { body: { ...tokenResponse, expires_in: 600 } })
      .on(ORDER, { body: orderCompletedVault });
    const pp = testClient(fake, { now: () => now, tokenMarginSeconds: 300 });
    await pp.orders.get("8AB12345CD678901E");
    now += 200_000; // 400s left > 300s margin
    await pp.orders.get("8AB12345CD678901E");
    expect(fake.to(TOKEN)).toHaveLength(1);
    now += 150_000; // 250s left < margin
    await pp.orders.get("8AB12345CD678901E");
    expect(fake.to(TOKEN)).toHaveLength(2);
  });

  it("shares one in-flight token fetch between concurrent calls", async () => {
    const fake = fakeFetch().on(ORDER, { body: orderCompletedVault });
    const pp = testClient(fake);
    await Promise.all([1, 2, 3].map(() => pp.orders.get("8AB12345CD678901E")));
    expect(fake.to(TOKEN)).toHaveLength(1);
  });

  it("uses the injected cache, keyed per env and client", async () => {
    const cache = memoryStore();
    const fake = fakeFetch().on(ORDER, { body: orderCompletedVault });
    await testClient(fake, { cache }).orders.get("8AB12345CD678901E");
    await testClient(fake, { cache }).orders.get("8AB12345CD678901E");
    expect(fake.to(TOKEN)).toHaveLength(1);
    expect(await cache.get("paypal:app-token:sandbox:test-client-id")).toContain(
      tokenResponse.access_token,
    );
  });

  it("drops a rejected token and retries once on 401", async () => {
    const fake = fakeFetch().on(
      ORDER,
      { status: 401, body: { name: "AUTHENTICATION_FAILURE", message: "expired" } },
      { body: orderCompletedVault },
    );
    const order = await testClient(fake).orders.get("8AB12345CD678901E");
    expect(order.status).toBe("COMPLETED");
    expect(fake.to(TOKEN)).toHaveLength(2);
  });

  it("surfaces OAuth errors without the secret", async () => {
    const fake = fakeFetch().on(TOKEN, { status: 401, body: errorOAuth });
    const err = await testClient(fake)
      .orders.get("x")
      .catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.code).toBe("invalid_client");
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain("test-client-secret");
  });
});

describe("errors", () => {
  it("keeps name, debug_id and issues; drops echoed values", async () => {
    const fake = fakeFetch().on(CREATE, { status: 422, body: error422 });
    const err: PayPalError = await testClient(fake)
      .orders.create(createInput, { requestId: "r1" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.code).toBe("UNPROCESSABLE_ENTITY");
    expect(err.debugId).toBe("f2b3c4d5e6f7a");
    expect(err.issues).toEqual(["INSTRUMENT_DECLINED"]);
    expect(err.hasIssue("INSTRUMENT_DECLINED")).toBe(true);
    expect(err.details[0]?.field).toBe("/payment_source/paypal/vault_id");
    expect(err.route).toBe("POST /v2/checkout/orders");
    expect(JSON.stringify(err.details)).not.toContain("8kk8451t");
    expect(err.message).not.toContain("8kk8451t");
    expect(fake.to(CREATE)).toHaveLength(1);
  });

  it("falls back to the debug id header for non-JSON bodies", async () => {
    const fake = fakeFetch().on(ORDER, {
      status: 400,
      body: "<html>bad</html>",
      headers: { "paypal-debug-id": "hdr123" },
    });
    const err: PayPalError = await testClient(fake)
      .orders.get("8AB12345CD678901E")
      .catch((e) => e);
    expect(err.code).toBe("HTTP_400");
    expect(err.debugId).toBe("hdr123");
  });

  it("rejects responses that don't match the schema", async () => {
    const fake = fakeFetch().on(ORDER, { body: { id: "x", status: "WEIRD" } });
    await expect(testClient(fake).orders.get("8AB12345CD678901E")).rejects.toBeInstanceOf(
      PayPalResponseError,
    );
  });
});

describe("retries", () => {
  it("retries 5xx and 429 on idempotent calls, honoring Retry-After", async () => {
    const sleeps: number[] = [];
    const fake = fakeFetch().on(
      CREATE,
      { status: 503, body: { name: "SERVICE_UNAVAILABLE" } },
      { status: 429, body: { name: "RATE_LIMIT_REACHED" }, headers: { "retry-after": "2" } },
      { status: 201, body: orderCompletedVault },
    );
    const pp = testClient(fake, { sleep: async (ms) => void sleeps.push(ms) });
    const order = await pp.orders.create(createInput, { requestId: "pact_1:run_1:u1" });
    expect(order.id).toBe("8AB12345CD678901E");
    expect(fake.to(CREATE)).toHaveLength(3);
    expect(sleeps[1]).toBe(2000);
    expect(new Set(fake.to(CREATE).map((c) => c.headers.get("paypal-request-id")))).toEqual(
      new Set(["pact_1:run_1:u1"]),
    );
  });

  it("stops after maxRetries", async () => {
    const fake = fakeFetch().on(ORDER, { status: 500, body: { name: "INTERNAL_SERVER_ERROR" } });
    const err = await testClient(fake, { maxRetries: 2 })
      .orders.get("8AB12345CD678901E")
      .catch((e) => e);
    expect(err.status).toBe(500);
    expect(fake.to(ORDER)).toHaveLength(3);
  });

  it("never retries 4xx", async () => {
    const fake = fakeFetch().on(ORDER, { status: 404, body: { name: "RESOURCE_NOT_FOUND" } });
    await expect(testClient(fake).orders.get("8AB12345CD678901E")).rejects.toThrow(
      /RESOURCE_NOT_FOUND/,
    );
    expect(fake.to(ORDER)).toHaveLength(1);
  });

  it("retries network errors on idempotent calls", async () => {
    const fake = fakeFetch().on(
      ORDER,
      { throws: new TypeError("socket hang up") },
      { body: orderCompletedVault },
    );
    expect((await testClient(fake).orders.get("8AB12345CD678901E")).id).toBe("8AB12345CD678901E");
  });

  it("does not retry non-idempotent calls (auth code exchange)", async () => {
    const fake = fakeFetch().on(TOKEN, { status: 503, body: { name: "SERVICE_UNAVAILABLE" } });
    await expect(testClient(fake).identity.exchangeCode("code123")).rejects.toThrow(/503/);
    expect(fake.to(TOKEN)).toHaveLength(1);
  });
});

describe("headers and safety", () => {
  it("sets request id, Prefer, mock, metadata and BN headers on mutating calls", async () => {
    const fake = fakeFetch().on(CREATE, { status: 201, body: orderCompletedVault });
    await testClient(fake, { partnerAttributionId: "PACT_SP" }).orders.create(createInput, {
      requestId: "k1",
      mock: "INSTRUMENT_DECLINED",
      clientMetadataId: "cmid-1",
    });
    const h = fake.last(CREATE).headers;
    expect(h.get("paypal-request-id")).toBe("k1");
    expect(h.get("prefer")).toBe("return=representation");
    expect(JSON.parse(h.get("paypal-mock-response") ?? "")).toEqual({
      mock_application_codes: "INSTRUMENT_DECLINED",
    });
    expect(h.get("paypal-client-metadata-id")).toBe("cmid-1");
    expect(h.get("paypal-partner-attribution-id")).toBe("PACT_SP");
  });

  it("validates the request id before any network call", async () => {
    const fake = fakeFetch();
    const pp = testClient(fake);
    await expect(pp.orders.create(createInput, { requestId: "" })).rejects.toThrow(/Request-Id/);
    await expect(pp.orders.create(createInput, { requestId: "x".repeat(109) })).rejects.toThrow(
      /Request-Id/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses mock responses on live", async () => {
    const pp = testClient(fakeFetch(), { env: "live" });
    await expect(
      pp.orders.create(createInput, { requestId: "k", mock: "INSTRUMENT_DECLINED" }),
    ).rejects.toThrow(/sandbox-only/);
  });

  it("rejects float money before sending", async () => {
    const fake = fakeFetch();
    await expect(
      testClient(fake).orders.create(
        { intent: "CAPTURE", purchase_units: [{ amount: { amountMinor: 12.5, currency: "USD" } }] },
        { requestId: "k" },
      ),
    ).rejects.toThrow();
    expect(fake.to(CREATE)).toHaveLength(0);
  });

  it("logs only route templates, never ids or tokens", async () => {
    const logs: RequestLog[] = [];
    const fake = fakeFetch().on("DELETE /v3/vault/payment-tokens/8kk8451t", { status: 204 });
    await testClient(fake, { onRequest: (l) => logs.push(l) }).vault.paymentTokens.delete(
      "8kk8451t",
      {
        requestId: "revoke-1",
      },
    );
    const dump = JSON.stringify(logs);
    expect(dump).toContain("/v3/vault/payment-tokens/:id");
    expect(dump).not.toContain("8kk8451t");
    expect(dump).not.toContain(tokenResponse.access_token);
  });

  it("targets the right host per env", async () => {
    const fake = fakeFetch().on(ORDER, { body: orderCompletedVault });
    await testClient(fake).orders.get("8AB12345CD678901E");
    expect(fake.last(ORDER).url.host).toBe("api-m.sandbox.paypal.com");
    const live = fakeFetch().on(ORDER, { body: orderCompletedVault });
    await testClient(live, { env: "live" }).orders.get("8AB12345CD678901E");
    expect(live.last(ORDER).url.host).toBe("api-m.paypal.com");
  });
});
