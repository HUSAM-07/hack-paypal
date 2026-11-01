/**
 * Step 9: webhooks. Needs a public HTTPS receiver (the deployed worker), set as
 * PAYPAL_WEBHOOK_URL. Creates/reuses a subscription for that URL and fires simulator
 * events at it; the worker then logs self-verify results. Without the URL it only lists
 * existing subscriptions.
 */
import { client, env, probe, rawToken } from "./_lib";

const pp = client();
const url = env("PAYPAL_WEBHOOK_URL");
const api = "https://api-m.sandbox.paypal.com";

// The client doesn't wrap webhook management (one-off dashboard work), so call it directly.
async function call(method: string, path: string, body?: unknown) {
  const { access_token } = await rawToken();
  const res = await fetch(api + path, {
    method,
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: res.status,
    debugId: res.headers.get("paypal-debug-id"),
    json: (await res.json()) as Record<string, unknown>,
  };
}

const EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.REFUNDED",
  "VAULT.PAYMENT-TOKEN.CREATED",
  "VAULT.PAYMENT-TOKEN.DELETED",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTSBATCH.PROCESSING",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
];

const list = await probe("09-webhooks", "list subscriptions", async () => {
  const r = await call("GET", "/v1/notifications/webhooks");
  const hooks = (r.json.webhooks as { id: string; url: string }[] | undefined) ?? [];
  return {
    status: r.status,
    count: hooks.length,
    urls: hooks.map((h) => h.url),
    ids: hooks.map((h) => h.id),
  };
});

if (!url) {
  console.log(
    "\nPAYPAL_WEBHOOK_URL not set: deploy the worker, then rerun to subscribe + simulate.",
  );
  process.exit(0);
}

const urls = (list?.urls as string[] | undefined) ?? [];
const ids = (list?.ids as string[] | undefined) ?? [];
let webhookId: string | undefined = ids[urls.indexOf(url)];
if (!webhookId) {
  const created = await probe("09-webhooks", "create subscription", async () => {
    const r = await call("POST", "/v1/notifications/webhooks", {
      url,
      event_types: EVENTS.map((name) => ({ name })),
    });
    return { status: r.status, webhookId: r.json.id, debugId: r.debugId, error: r.json.name };
  });
  webhookId = created?.webhookId as string | undefined;
}
console.log(`\n  PAYPAL_WEBHOOK_ID=${webhookId}  (put this in the worker's secrets)`);

for (const event_type of ["PAYMENT.CAPTURE.COMPLETED", "VAULT.PAYMENT-TOKEN.CREATED"]) {
  await probe("09-webhooks", `simulate ${event_type}`, async () => {
    const r = await call("POST", "/v1/notifications/simulate-event", {
      webhook_id: webhookId,
      event_type,
    });
    return { status: r.status, eventId: r.json.id, debugId: r.debugId };
  });
}
