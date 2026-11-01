import { beforeAll, describe, expect, it } from "vitest";
import { verifyWebhook } from "../client";
import { memoryStore } from "../store";
import { fakeFetch, testClient } from "../testing/fake-fetch";
import * as fx from "../testing/fixtures";
import { makeTestCert, signWebhook, TEST_CERT_URL, type TestSigner } from "../testing/x509";
import { crc32, parseCertificate } from "./crypto";
import { createWebhookDeduper } from "./dedupe";
import { parseWebhookEvent } from "./events";
import { isAllowedCertUrl, type SelfVerifyInput, verifyWebhookSelf } from "./verify";

const enc = (s: string) => new TextEncoder().encode(s);
const NOW = Date.parse("2026-11-01T12:00:00Z");
const WEBHOOK_ID = "1JE4291016473214C";

describe("crc32", () => {
  it("matches the standard check values", () => {
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
    expect(crc32(enc(""))).toBe(0);
    expect(crc32(enc("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("cert url allowlist", () => {
  it.each([
    [TEST_CERT_URL, "sandbox", true],
    ["https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1", "sandbox", true],
    ["https://api.paypal.com/v1/notifications/certs/CERT-1", "live", true],
    ["https://api.paypal.com/v1/notifications/certs/CERT-1", "sandbox", false],
    ["http://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "sandbox", false],
    ["https://api.sandbox.paypal.com.evil.com/v1/notifications/certs/CERT-1", "sandbox", false],
    ["https://evil.com/v1/notifications/certs/CERT-1", "sandbox", false],
    ["https://api.sandbox.paypal.com:8443/v1/notifications/certs/CERT-1", "sandbox", false],
    ["https://user@api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "sandbox", false],
    ["https://api.sandbox.paypal.com/v1/other/CERT-1", "sandbox", false],
    ["not a url", "sandbox", false],
  ] as const)("%s on %s → %s", (url, env, ok) => {
    expect(isAllowedCertUrl(url, env)).toBe(ok);
  });
});

describe("self-verify", () => {
  let signer: TestSigner;
  const rawBody = JSON.stringify({
    id: "WH-58D329510W468432D-8HN650336L201105X",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: fx.capture,
  });

  beforeAll(async () => {
    signer = await makeTestCert({
      notBefore: new Date("2026-01-01T00:00:00Z"),
      notAfter: new Date("2027-01-01T00:00:00Z"),
    });
  });

  function certFetch(pem: string, counter?: { n: number }) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(TEST_CERT_URL);
      expect(init?.redirect).toBe("manual");
      if (counter) counter.n++;
      return new Response(pem, { status: 200 });
    }) as typeof fetch;
  }

  async function input(over: Partial<SelfVerifyInput> = {}): Promise<SelfVerifyInput> {
    return {
      env: "sandbox",
      webhookId: WEBHOOK_ID,
      rawBody,
      headers: await signWebhook(signer, { rawBody, webhookId: WEBHOOK_ID }),
      fetch: certFetch(signer.certPem),
      certCache: memoryStore(),
      now: () => NOW,
      ...over,
    };
  }

  it("parses the generated cert the same way node:crypto does", async () => {
    const parsed = parseCertificate(signer.certPem);
    expect(parsed.spki).toEqual(signer.spki);
    expect(parsed.notBefore).toBe(Date.parse("2026-01-01T00:00:00Z"));
    // Cross-check that the test cert is a real, well-formed X.509 by a second parser.
    const nodeCrypto = await import("node:crypto" as string);
    const x = new nodeCrypto.X509Certificate(signer.certPem);
    expect(Date.parse(x.validTo)).toBe(parsed.notAfter);
    const nodeSpki = x.publicKey.export({ type: "spki", format: "der" }) as Uint8Array;
    expect(new Uint8Array(nodeSpki)).toEqual(parsed.spki);
  });

  it("accepts a correctly signed event (string and bytes body)", async () => {
    expect(await verifyWebhookSelf(await input())).toEqual({ ok: true });
    expect(await verifyWebhookSelf(await input({ rawBody: enc(rawBody) }))).toEqual({ ok: true });
  });

  it("accepts a Headers instance", async () => {
    const h = new Headers(await signWebhook(signer, { rawBody, webhookId: WEBHOOK_ID }));
    expect(await verifyWebhookSelf(await input({ headers: h }))).toEqual({ ok: true });
  });

  it("rejects a tampered body", async () => {
    const r = await verifyWebhookSelf(
      await input({ rawBody: rawBody.replace("25.00", "2500.00") }),
    );
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a different webhook id", async () => {
    expect(await verifyWebhookSelf(await input({ webhookId: "OTHER" }))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a signature from another key", async () => {
    const other = await makeTestCert({
      notBefore: new Date("2026-01-01"),
      notAfter: new Date("2027-01-01"),
    });
    const headers = await signWebhook(other, { rawBody, webhookId: WEBHOOK_ID });
    expect(await verifyWebhookSelf(await input({ headers }))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects disallowed cert hosts without fetching", async () => {
    let fetched = false;
    const headers = await signWebhook(signer, {
      rawBody,
      webhookId: WEBHOOK_ID,
      certUrl: "https://evil.example/v1/notifications/certs/x",
    });
    const r = await verifyWebhookSelf(
      await input({
        headers,
        fetch: (async () => {
          fetched = true;
          return new Response("");
        }) as typeof fetch,
      }),
    );
    expect(r).toEqual({ ok: false, reason: "cert_url_not_allowed" });
    expect(fetched).toBe(false);
  });

  it("rejects missing headers and other algorithms", async () => {
    expect(await verifyWebhookSelf(await input({ headers: {} }))).toEqual({
      ok: false,
      reason: "missing_headers",
    });
    const headers = {
      ...(await signWebhook(signer, { rawBody, webhookId: WEBHOOK_ID })),
      "paypal-auth-algo": "SHA1withRSA",
    };
    expect(await verifyWebhookSelf(await input({ headers }))).toEqual({
      ok: false,
      reason: "unsupported_algorithm",
    });
  });

  it("rejects expired certs", async () => {
    const r = await verifyWebhookSelf(
      await input({ now: () => Date.parse("2027-06-01T00:00:00Z") }),
    );
    expect(r).toEqual({ ok: false, reason: "cert_not_valid_now" });
  });

  it("rejects garbage certs and failed fetches", async () => {
    expect(await verifyWebhookSelf(await input({ fetch: certFetch("not a cert") }))).toEqual({
      ok: false,
      reason: "cert_invalid",
    });
    const redirect = (async () => new Response(null, { status: 302 })) as typeof fetch;
    expect(await verifyWebhookSelf(await input({ fetch: redirect }))).toEqual({
      ok: false,
      reason: "cert_fetch_failed",
    });
  });

  it("caches the cert by URL", async () => {
    const counter = { n: 0 };
    const certCache = memoryStore();
    const base = await input({ fetch: certFetch(signer.certPem, counter), certCache });
    await verifyWebhookSelf(base);
    await verifyWebhookSelf(base);
    expect(counter.n).toBe(1);
  });

  it("optionally rejects stale transmissions", async () => {
    const r = await verifyWebhookSelf(await input({ maxAgeSeconds: 60 }));
    expect(r).toEqual({ ok: false, reason: "stale_transmission" });
  });

  it("works through createPayPal().webhooks.verifySelf and verifyWebhook()", async () => {
    const { env: _env, ...rest } = await input();
    expect(await testClient(fakeFetch()).webhooks.verifySelf(rest)).toEqual({ ok: true });
    expect(await verifyWebhook({ strategy: "self", ...(await input()) })).toEqual({ ok: true });
  });
});

describe("postback verify", () => {
  const rawBody = JSON.stringify({
    id: "WH-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: fx.capture,
  });
  const headers = {
    "PAYPAL-TRANSMISSION-ID": "t1",
    "PAYPAL-TRANSMISSION-TIME": "2026-11-01T10:00:00Z",
    "PAYPAL-TRANSMISSION-SIG": "c2ln",
    "PAYPAL-CERT-URL": TEST_CERT_URL,
    "PAYPAL-AUTH-ALGO": "SHA256withRSA",
  };

  it("posts the headers and parsed event, maps SUCCESS/FAILURE", async () => {
    const fake = fakeFetch().on(
      "POST /v1/notifications/verify-webhook-signature",
      { body: { verification_status: "SUCCESS" } },
      { body: { verification_status: "FAILURE" } },
    );
    const pp = testClient(fake);
    expect(
      await verifyWebhook({
        strategy: "postback",
        paypal: pp,
        webhookId: WEBHOOK_ID,
        headers,
        rawBody,
      }),
    ).toEqual({
      ok: true,
    });
    expect(fake.last("POST /v1/notifications/verify-webhook-signature").body).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: TEST_CERT_URL,
      transmission_id: "t1",
      transmission_sig: "c2ln",
      transmission_time: "2026-11-01T10:00:00Z",
      webhook_id: WEBHOOK_ID,
      webhook_event: JSON.parse(rawBody),
    });
    expect(await pp.webhooks.verifyByPostback({ webhookId: WEBHOOK_ID, headers, rawBody })).toEqual(
      {
        ok: false,
        reason: "postback_failure",
      },
    );
  });

  it("fails fast on missing headers or bad JSON", async () => {
    const fake = fakeFetch();
    const pp = testClient(fake);
    expect(await pp.webhooks.verifyByPostback({ webhookId: "w", headers: {}, rawBody })).toEqual({
      ok: false,
      reason: "missing_headers",
    });
    expect(await pp.webhooks.verifyByPostback({ webhookId: "w", headers, rawBody: "{" })).toEqual({
      ok: false,
      reason: "postback_failure",
    });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("events", () => {
  const wrap = (event_type: string, resource: unknown) =>
    JSON.stringify({
      id: `WH-${event_type}`,
      event_type,
      resource_type: "x",
      create_time: "2026-11-01T10:00:00Z",
      resource,
    });

  it("types every subscribed event family", () => {
    const cases: [string, unknown][] = [
      ["CHECKOUT.ORDER.APPROVED", { ...fx.orderApproved }],
      ["PAYMENT.AUTHORIZATION.CREATED", fx.authorization],
      ["PAYMENT.AUTHORIZATION.VOIDED", { ...fx.authorization, status: "VOIDED" }],
      ["PAYMENT.CAPTURE.COMPLETED", fx.capture],
      ["PAYMENT.CAPTURE.DECLINED", { ...fx.capture, status: "DECLINED" }],
      ["PAYMENT.CAPTURE.DENIED", { ...fx.capture, status: "DECLINED" }],
      ["PAYMENT.CAPTURE.PENDING", { ...fx.capture, status: "PENDING" }],
      ["PAYMENT.CAPTURE.REFUNDED", fx.refund],
      ["VAULT.PAYMENT-TOKEN.CREATED", fx.paymentToken],
      ["VAULT.PAYMENT-TOKEN.DELETED", { id: "8kk8451t" }],
      ["PAYMENT.PAYOUTSBATCH.SUCCESS", { batch_header: fx.payoutBatch.batch_header }],
      ["PAYMENT.PAYOUTS-ITEM.SUCCEEDED", fx.payoutItem],
      ["PAYMENT.PAYOUTS-ITEM.UNCLAIMED", { ...fx.payoutItem, transaction_status: "UNCLAIMED" }],
      ["INVOICING.INVOICE.PAID", { invoice: fx.invoicePaid }],
      ["INVOICING.INVOICE.CANCELLED", { invoice: { ...fx.invoiceDraft, status: "CANCELLED" } }],
    ];
    for (const [type, resource] of cases) {
      const parsed = parseWebhookEvent(wrap(type, resource));
      expect(parsed.known, type).toBe(true);
      if (parsed.known) expect(parsed.event.event_type).toBe(type);
    }
  });

  it("narrows on event_type with Money resources", () => {
    const parsed = parseWebhookEvent(wrap("PAYMENT.CAPTURE.COMPLETED", fx.capture));
    if (!parsed.known) throw new Error("expected known");
    const e = parsed.event;
    if (e.event_type !== "PAYMENT.CAPTURE.COMPLETED") throw new Error("narrowing");
    expect(e.resource.amount).toEqual({ amountMinor: 2500, currency: "USD" });
    expect(e.resource.custom_id).toBe("pact_1");
  });

  it("returns unknown events without throwing", () => {
    const parsed = parseWebhookEvent(wrap("BILLING.SUBSCRIPTION.CREATED", { id: "I-1" }));
    expect(parsed).toEqual({
      known: false,
      id: "WH-BILLING.SUBSCRIPTION.CREATED",
      eventType: "BILLING.SUBSCRIPTION.CREATED",
      resource: { id: "I-1" },
    });
  });

  it("throws on non-envelopes", () => {
    expect(() => parseWebhookEvent("{}")).toThrow();
    expect(() => parseWebhookEvent("nope")).toThrow();
  });
});

describe("dedupe", () => {
  it("claims once per event id, release allows reprocessing, TTL expires marks", async () => {
    let now = 0;
    const d = createWebhookDeduper(
      memoryStore(() => now),
      { ttlSeconds: 10 },
    );
    expect(await d.claim("WH-1")).toBe(true);
    expect(await d.claim("WH-1")).toBe(false);
    expect(await d.claim("WH-2")).toBe(true);
    await d.release("WH-2");
    expect(await d.claim("WH-2")).toBe(true);
    now = 11_000;
    expect(await d.claim("WH-1")).toBe(true);
  });
});
