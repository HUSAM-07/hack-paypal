import { env } from "cloudflare:workers";
import { MOCK_CERT_URL } from "@pact/paypal";
import { makeTestCert, signWebhook, type TestSigner } from "@pact/paypal/testing/x509";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";

const e = env as unknown as Env;
const SUBSCRIPTION = "WH-TEST-ID"; // PAYPAL_WEBHOOK_ID in vitest.config.ts

let signer: TestSigner;
beforeAll(async () => {
  signer = await makeTestCert({
    notBefore: new Date("2026-01-01T00:00:00Z"),
    notAfter: new Date("2030-01-01T00:00:00Z"),
  });
});
afterEach(() => vi.restoreAllMocks());

let n = 0;
/** A fresh cert URL per event: the engine caches certs by URL across tests. */
function certUrl(): string {
  return `https://api.sandbox.paypal.com/v1/notifications/certs/CERT-proof-${++n}`;
}

function servePem(url: string) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    String(input instanceof Request ? input.url : input) === url
      ? new Response(signer.certPem, { status: 200 })
      : new Response("", { status: 404 }),
  );
}

const capture = (captureId: string) => ({
  id: `WH-PROOF-${captureId}`,
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: {
    id: captureId,
    status: "COMPLETED",
    amount: { currency_code: "USD", value: "30.00" },
    create_time: "2026-11-01T10:00:00Z",
    supplementary_data: { related_ids: { order_id: `O-${captureId}` } },
  },
});

async function post(
  event: object,
  opts: {
    mode?: string;
    webhookId?: string;
    headers?: Record<string, string>;
    transmissionId?: string;
  } = {},
) {
  const rawBody = JSON.stringify(event);
  let headers = opts.headers;
  if (!headers && opts.webhookId) {
    const url = certUrl();
    servePem(url);
    headers = await signWebhook(signer, {
      rawBody,
      webhookId: opts.webhookId,
      certUrl: url,
      transmissionId: opts.transmissionId ?? crypto.randomUUID(),
    });
  }
  return app.request(
    "/webhooks/paypal",
    { method: "POST", body: rawBody, headers: headers ?? {} },
    { ...e, PAYPAL_MODE: opts.mode ?? "simulated" },
  );
}

const claimed = (eventId: string) =>
  e.DB.prepare("SELECT 1 AS x FROM webhook_events WHERE id = ?").bind(eventId).first();
const saleRow = (captureId: string) =>
  e.DB.prepare("SELECT 1 AS x FROM sales WHERE capture_id = ?").bind(captureId).first();

async function proofs() {
  const res = await app.request("/api/webhook-proof", {}, e);
  return (await res.json()) as {
    subscriptionId: string;
    proofs: { eventId: string; signedFor: string; verified: boolean; dispatched: boolean }[];
  };
}

describe("real PayPal signatures on the simulated engine", () => {
  it("verifies a simulator-signed event, records it, and keeps it out of the ledger", async () => {
    const ev = capture("C-SIM-1");
    const res = await post(ev, { webhookId: "WEBHOOK_ID", transmissionId: "T-SIM-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, proof: "simulator" });
    expect(await claimed(ev.id)).toBeNull();
    expect(await saleRow("C-SIM-1")).toBeNull();

    const listed = await proofs();
    expect(listed.subscriptionId).toBe(SUBSCRIPTION);
    expect(listed.proofs.find((p) => p.eventId === ev.id)).toMatchObject({
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      source: "paypal-sandbox",
      signedFor: "simulator",
      verified: true,
      dispatched: false,
      resourceId: "C-SIM-1",
    });

    // The same transmission again is a duplicate; a new transmission of the same event (the
    // simulator reuses event ids) is a new proof.
    const again = await post(ev, { webhookId: "WEBHOOK_ID", transmissionId: "T-SIM-1" });
    expect(await again.json()).toEqual({ ok: true, proof: "simulator", duplicate: true });
    const rerun = await post(ev, { webhookId: "WEBHOOK_ID" });
    expect(await rerun.json()).toEqual({ ok: true, proof: "simulator" });
    expect((await proofs()).proofs.filter((p) => p.eventId === ev.id)).toHaveLength(2);
  });

  it("records an event signed for our subscription without dispatching it", async () => {
    const ev = capture("C-SUB-1");
    const res = await post(ev, { webhookId: SUBSCRIPTION });
    expect(await res.json()).toEqual({ ok: true, proof: "subscription" });
    expect(await saleRow("C-SUB-1")).toBeNull();
    expect((await proofs()).proofs.find((p) => p.eventId === ev.id)?.signedFor).toBe(
      "subscription",
    );
  });

  it("rejects PayPal headers whose signature does not verify", async () => {
    const ev = capture("C-BAD-1");
    const res = await post(ev, { webhookId: "SOMEONE-ELSE" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_signature" });
    expect((await proofs()).proofs.some((p) => p.eventId === ev.id)).toBe(false);
  });

  it("rejects a cert URL off PayPal's hosts and partial PayPal headers", async () => {
    const ev = capture("C-BAD-2");
    const rawBody = JSON.stringify(ev);
    const offHost = await signWebhook(signer, {
      rawBody,
      webhookId: "WEBHOOK_ID",
      certUrl: "https://example.com/v1/notifications/certs/CERT-x",
    });
    expect(await (await post(ev, { headers: offHost })).json()).toEqual({
      error: "cert_url_not_allowed",
    });
    const partial = await post(ev, { headers: { "paypal-cert-url": certUrl() } });
    expect(partial.status).toBe(400);
    expect(await partial.json()).toEqual({ error: "missing_headers" });
    expect(await saleRow("C-BAD-2")).toBeNull();
  });

  it("dispatches events the simulated PayPal signs with its own cert", async () => {
    const ev = capture("C-MOCK-1");
    const headers = await signWebhook(signer, {
      rawBody: JSON.stringify(ev),
      webhookId: "WH-MOCK-0001",
      certUrl: MOCK_CERT_URL,
    });
    expect(await (await post(ev, { headers })).json()).toEqual({ ok: true });
    expect(await claimed(ev.id)).not.toBeNull();
  });

  it("still dispatches the demo's own unsigned events", async () => {
    const ev = capture("C-DEMO-1");
    const res = await post(ev);
    expect(await res.json()).toEqual({ ok: true });
    expect(await claimed(ev.id)).not.toBeNull();
    expect((await proofs()).proofs.some((p) => p.eventId === ev.id)).toBe(false);
  });
});

describe("real PayPal mode", () => {
  it("dispatches a subscription-signed event and records it as proof", async () => {
    const ev = capture("C-SBX-1");
    const res = await post(ev, { mode: "sandbox", webhookId: SUBSCRIPTION });
    expect(await res.json()).toEqual({ ok: true });
    expect(await claimed(ev.id)).not.toBeNull();
    expect((await proofs()).proofs.find((p) => p.eventId === ev.id)?.dispatched).toBe(true);
  });

  it("records a simulator-signed event but never dispatches it", async () => {
    const ev = capture("C-SBX-2");
    const res = await post(ev, { mode: "sandbox", webhookId: "WEBHOOK_ID" });
    expect(await res.json()).toEqual({ ok: true, proof: "simulator" });
    expect(await claimed(ev.id)).toBeNull();
  });
});
