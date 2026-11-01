import type { FakeFetch } from "@pact/paypal/testing/fake-fetch";
import {
  makeTestCert,
  signWebhook,
  TEST_CERT_URL,
  type TestSigner,
} from "@pact/paypal/testing/x509";
import type { Mandate } from "@pact/protocol";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { api, devLogin, TestClient } from "./helpers/client";
import { completedOrder, fx, sandbox, simulated, tag, testEnv, userDO } from "./helpers/paypal";

afterEach(simulated);

let signer: TestSigner;
beforeAll(async () => {
  signer = await makeTestCert({
    notBefore: new Date(Date.now() - 86_400_000),
    notAfter: new Date(Date.now() + 365 * 86_400_000),
  });
});

function withCert(fake: FakeFetch): FakeFetch {
  return fake.on(`GET ${new URL(TEST_CERT_URL).pathname}`, { body: signer.certPem });
}

async function deliver(event: Record<string, unknown>, opts: { webhookId?: string } = {}) {
  const raw = JSON.stringify(event);
  const headers = await signWebhook(signer, {
    rawBody: raw,
    webhookId: opts.webhookId ?? testEnv.PAYPAL_WEBHOOK_ID ?? "",
    transmissionId: crypto.randomUUID(),
  });
  return api("/api/paypal/webhooks", {
    method: "POST",
    body: raw,
    headers: { ...headers, "content-type": "application/json" },
  });
}

function mandate(userId: string): Mandate {
  return {
    id: `mnd_${crypto.randomUUID().slice(0, 8)}`,
    userId,
    maxPerCharge: { amountMinor: 50_000, currency: "USD" },
    maxTotal: { amountMinor: 100_000, currency: "USD" },
    period: "none",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-12-31T00:00:00.000Z",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A purchase whose capture PayPal leaves PENDING, so a webhook has to finish it. */
async function pendingPurchase(fake: FakeFetch, prefix: string) {
  const t = tag(prefix);
  const u = await devLogin(t);
  const vaultId = `VAULT-${t}`;
  await userDO(u.userId).completeSetup({
    setupTokenId: `SETUP-${t}`,
    userId: u.userId,
    vaultId,
    customerId: `cust-${t}`,
    payerEmail: undefined,
    mandate: mandate(u.userId),
    label: "Everyday",
  });
  const captureId = `CAP-${t}`.toUpperCase();
  const order = completedOrder(`ORD-${t}`.toUpperCase(), captureId, "79.99");
  const unit = order.purchase_units[0] as { payments: { captures: { status: string }[] } };
  (unit.payments.captures[0] as { status: string }).status = "PENDING";
  fake.on("POST /v2/checkout/orders", { body: order });

  const { client, threadId } = await TestClient.open(u.cookie);
  await client.call("turn/start", {
    threadId,
    text: "find me noise-cancelling headphones under $300",
  });
  await client.turnCompleted(1);
  await client.call("turn/start", { threadId, text: "buy the first one" });
  await client.turnCompleted(2);
  expect(client.items("paymentEvent")).toHaveLength(0);
  expect(client.items("systemNotice")[0]).toMatchObject({ level: "info" });
  return { ...u, client, captureId, vaultId };
}

function captureEvent(type: string, captureId: string) {
  return {
    id: `WH-${crypto.randomUUID()}`,
    event_type: type,
    resource_type: "capture",
    resource: {
      ...fx.capture,
      id: captureId,
      status: type.endsWith("COMPLETED") ? "COMPLETED" : "DECLINED",
    },
  };
}

describe("POST /api/paypal/webhooks", () => {
  it("rejects a bad signature before parsing anything", async () => {
    withCert(sandbox());
    const res = await deliver(captureEvent("PAYMENT.CAPTURE.COMPLETED", "CAP-X"), {
      webhookId: "SOMEONE-ELSES-WEBHOOK",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_signature" });
    const unsigned = await api("/api/paypal/webhooks", { method: "POST", body: "{}" });
    expect(unsigned.status).toBe(400);
  });

  it("completes a pending capture and dedupes redeliveries", async () => {
    const fake = withCert(sandbox());
    const p = await pendingPurchase(fake, "whdone");
    const event = captureEvent("PAYMENT.CAPTURE.COMPLETED", p.captureId);

    const res = await deliver(event);
    expect(await res.json()).toEqual({ ok: true });
    await p.client.waitFor(() => p.client.items("paymentEvent").length === 1);
    expect(p.client.items("paymentEvent")[0]).toMatchObject({
      kind: "charged",
      userId: p.userId,
      paypalRef: p.captureId,
    });
    const wallet = await userDO(p.userId).wallet();
    expect(wallet.activity[0]).toMatchObject({ kind: "charged" });
    expect(wallet.activity[0]).not.toHaveProperty("subtitle");

    const dup = await deliver(event);
    expect(await dup.json()).toEqual({ ok: true, duplicate: true });
    // A distinct event saying the same thing is a no-op too.
    await deliver(captureEvent("PAYMENT.CAPTURE.COMPLETED", p.captureId));
    expect(p.client.items("paymentEvent")).toHaveLength(1);
  });

  it("fails a denied capture and gives the reservation back", async () => {
    const fake = withCert(sandbox());
    const p = await pendingPurchase(fake, "whdeny");
    expect(await userDO(p.userId).ledger()).toHaveLength(1);
    await deliver(captureEvent("PAYMENT.CAPTURE.DENIED", p.captureId));
    await p.client.waitFor(() => p.client.items("paymentEvent").length === 1);
    expect(p.client.items("paymentEvent")[0]).toMatchObject({ kind: "chargeFailed" });
    expect(await userDO(p.userId).ledger()).toEqual([]);
  });

  it("revokes mandates when PayPal deletes the vault token", async () => {
    const fake = withCert(sandbox());
    const p = await pendingPurchase(fake, "whvault");
    const res = await deliver({
      id: `WH-${crypto.randomUUID()}`,
      event_type: "VAULT.PAYMENT-TOKEN.DELETED",
      resource: { id: p.vaultId },
    });
    expect(res.status).toBe(200);
    const mandates = await userDO(p.userId).listMandates();
    expect(mandates.map((m) => m.status)).toEqual(["revoked"]);
    expect((await userDO(p.userId).wallet()).funding.linked).toBe(false);
  });

  it("acknowledges events it doesn't act on", async () => {
    withCert(sandbox());
    const res = await deliver({
      id: `WH-${crypto.randomUUID()}`,
      event_type: "CUSTOMER.DISPUTE.CREATED",
      resource: {},
    });
    expect(await res.json()).toEqual({ ok: true });
  });

  it("is off in simulated mode", async () => {
    const res = await api("/api/paypal/webhooks", { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });
});
