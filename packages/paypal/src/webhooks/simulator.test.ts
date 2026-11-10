/**
 * Real deliveries from PayPal's sandbox webhook simulator, captured with their PayPal headers
 * (no other headers kept), plus the sandbox signing cert they point at. Verified offline.
 */
import { describe, expect, it } from "vitest";
import { memoryStore } from "../store";
import { SANDBOX_CERT_PEM as pem } from "./fixtures/sandbox-cert";
import completed from "./fixtures/simulator-capture-completed.json";
import refunded from "./fixtures/simulator-capture-refunded.json";
import { SIMULATOR_WEBHOOK_ID, verifyWebhookSelf } from "./verify";

const certFetch = (async (url: string) =>
  url === completed.headers["paypal-cert-url"]
    ? new Response(pem, { status: 200 })
    : new Response("", { status: 404 })) as unknown as typeof fetch;

const verify = (fx: typeof completed, webhookId: string, rawBody = fx.rawBody) =>
  verifyWebhookSelf({
    env: "sandbox",
    webhookId,
    headers: fx.headers,
    rawBody,
    fetch: certFetch,
    certCache: memoryStore(),
    now: () => Date.parse(fx.headers["paypal-transmission-time"]),
  });

describe("PayPal sandbox simulator deliveries", () => {
  for (const [name, fx] of [
    ["PAYMENT.CAPTURE.COMPLETED", completed],
    ["PAYMENT.CAPTURE.REFUNDED", refunded],
  ] as const) {
    it(`verifies a real ${name} signature against the simulator id`, async () => {
      expect(JSON.parse(fx.rawBody).event_type).toBe(name);
      expect(await verify(fx, SIMULATOR_WEBHOOK_ID)).toEqual({ ok: true });
    });
  }

  it("does not verify against a subscription id", async () => {
    expect(await verify(completed, "8042373202922840X")).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects one changed byte of the body", async () => {
    const tampered = completed.rawBody.replace('"30.00"', '"31.00"');
    expect(tampered).not.toBe(completed.rawBody);
    expect(await verify(completed, SIMULATOR_WEBHOOK_ID, tampered)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});
