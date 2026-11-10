/**
 * Proof that real PayPal-signed webhooks reach the engine. The hosted demo runs simulated
 * PayPal, so it otherwise never checks a signature; a request that carries PayPal's signature
 * headers is verified for real anyway (offline, against the cert at its allowlisted
 * `paypal-cert-url`) and recorded here. Verified events are recorded, not dispatched, unless the
 * engine runs real PayPal and the signature binds to our own subscription.
 */
import {
  readWebhookHeaders,
  SIMULATOR_WEBHOOK_ID,
  type VerifyFailure,
  verifyWebhookSelf,
} from "@pact/paypal";
import type { Env } from "../env";

export type SignedFor = "subscription" | "simulator";

export type PayPalSignature =
  | { ok: true; signedFor: SignedFor }
  | { ok: false; reason: VerifyFailure };

/** Sandbox certs unless the engine runs live PayPal (the hosted simulated demo's subscription is sandbox). */
export const paypalEnvOf = (env: Env) => (env.PAYPAL_MODE === "live" ? "live" : "sandbox");

/**
 * Our subscription id first; then the simulator's id, which proves the bytes were signed by
 * PayPal but not that PayPal sent them to this subscription. The caller records which.
 */
export async function verifyPayPalSignature(
  env: Env,
  headers: Headers,
  rawBody: string,
): Promise<PayPalSignature> {
  const ids: [string, SignedFor][] = [];
  if (env.PAYPAL_WEBHOOK_ID) ids.push([env.PAYPAL_WEBHOOK_ID, "subscription"]);
  ids.push([SIMULATOR_WEBHOOK_ID, "simulator"]);
  let failure: VerifyFailure = "bad_signature";
  for (const [webhookId, signedFor] of ids) {
    const r = await verifyWebhookSelf({
      env: paypalEnvOf(env),
      webhookId,
      headers,
      rawBody,
    });
    if (r.ok) return { ok: true, signedFor };
    failure = r.reason;
    // Only a signature mismatch can depend on the webhook id; anything else fails for both.
    if (r.reason !== "bad_signature") break;
  }
  return { ok: false, reason: failure };
}

export interface ProofRow {
  eventId: string;
  eventType: string;
  source: string;
  signedFor: SignedFor;
  verified: boolean;
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  resourceId: string | null;
  dispatched: boolean;
  receivedAt: string;
}

/** Records a verified delivery. False when this transmission was already recorded. */
export async function recordProof(
  env: Env,
  x: {
    eventId: string;
    eventType: string;
    signedFor: SignedFor;
    headers: Headers;
    resourceId: string | undefined;
    dispatched: boolean;
  },
): Promise<boolean> {
  const h = readWebhookHeaders(x.headers);
  if (!h) return false;
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_proofs (event_id, event_type, source, signed_for, verified,
       transmission_id, transmission_time, cert_url, resource_id, dispatched, received_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      x.eventId,
      x.eventType,
      `paypal-${paypalEnvOf(env)}`,
      x.signedFor,
      h.transmissionId,
      h.transmissionTime,
      h.certUrl,
      x.resourceId ?? null,
      x.dispatched ? 1 : 0,
      new Date().toISOString(),
    )
    .run();
  return res.meta.changes > 0;
}

export async function listProofs(env: Env, limit = 50): Promise<ProofRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM webhook_proofs ORDER BY received_at DESC, transmission_id LIMIT ?",
  )
    .bind(limit)
    .all<Record<string, unknown>>();
  return results.map((r) => ({
    eventId: r.event_id as string,
    eventType: r.event_type as string,
    source: r.source as string,
    signedFor: r.signed_for as SignedFor,
    verified: r.verified === 1,
    transmissionId: r.transmission_id as string,
    transmissionTime: r.transmission_time as string,
    certUrl: r.cert_url as string,
    resourceId: (r.resource_id as string | null) ?? null,
    dispatched: r.dispatched === 1,
    receivedAt: r.received_at as string,
  }));
}
