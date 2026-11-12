#!/usr/bin/env node
/**
 * Proves the hosted engine verifies real PayPal-signed webhooks. Asks PayPal's sandbox webhook
 * simulator to deliver PAYMENT.CAPTURE.COMPLETED and PAYMENT.CAPTURE.REFUNDED to CITED's
 * subscription, then polls /api/cited/api/webhook-proof until both show verified=true.
 *
 *   node --env-file=<path to .env with PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET> scripts/webhook-proof.mjs
 *
 * Optional env: CITED_BASE_URL (default the deployed worker), CITED_PAYPAL_WEBHOOK_ID (default
 * the sandbox subscription). Credentials are read from env and never printed.
 */
const BASE = (process.env.CITED_BASE_URL ?? "https://caaash.shipwith.si").replace(/\/$/, "");
const WEBHOOK_ID = process.env.CITED_PAYPAL_WEBHOOK_ID ?? "422572436A741503U";
const PAYPAL = "https://api-m.sandbox.paypal.com";
const TYPES = ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.REFUNDED"];
const TIMEOUT_MS = 180_000;

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function token() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) fail("set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox app)");
  const res = await fetch(`${PAYPAL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) fail(`PayPal token request failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function simulate(accessToken, eventType) {
  const res = await fetch(`${PAYPAL}/v1/notifications/simulate-event`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      webhook_id: WEBHOOK_ID,
      event_type: eventType,
      resource_version: "2.0",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id) fail(`simulate-event ${eventType} failed: HTTP ${res.status}`);
  return body.id;
}

async function proofs() {
  const res = await fetch(`${BASE}/api/cited/api/webhook-proof`);
  if (!res.ok)
    fail(`GET /api/cited/api/webhook-proof: HTTP ${res.status} (is this change deployed?)`);
  return (await res.json()).proofs ?? [];
}

// The simulator reuses fixed event ids, so only deliveries received after this run count.
const since = new Date(Date.now() - 5_000).toISOString();
const accessToken = await token();
const sent = [];
for (const type of TYPES) {
  const id = await simulate(accessToken, type);
  sent.push({ id, type });
  console.log(`→ PayPal simulator queued ${type} as ${id} for webhook ${WEBHOOK_ID}`);
}

const started = Date.now();
const seen = new Map();
while (seen.size < sent.length) {
  if (Date.now() - started > TIMEOUT_MS)
    fail(
      `timed out; still waiting for ${sent
        .filter((s) => !seen.has(s.id))
        .map((s) => s.id)
        .join(", ")}`,
    );
  await new Promise((r) => setTimeout(r, 5_000));
  for (const p of await proofs()) {
    const want = sent.find((s) => s.id === p.eventId);
    if (want && p.verified && p.receivedAt >= since && !seen.has(p.eventId)) {
      seen.set(p.eventId, p);
      console.log(
        `✔ ${p.eventType} ${p.eventId} verified=true signedFor=${p.signedFor} transmission=${p.transmissionId} cert=${p.certUrl}`,
      );
    }
  }
}
console.log(
  `✔ done: ${seen.size} PayPal-signed events verified at ${BASE}/api/cited/api/webhook-proof`,
);
