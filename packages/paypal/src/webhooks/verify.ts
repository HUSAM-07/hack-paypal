/**
 * Webhook signature verification, two ways:
 *
 * - `postback`: ask PayPal (`/v1/notifications/verify-webhook-signature`). Authoritative
 *   but costs a round trip, and does not work for dashboard simulator events.
 * - `self`: verify locally. Signed message is
 *   `transmissionId|transmissionTime|webhookId|crc32(rawBody)`, SHA256withRSA, with the
 *   key from the cert at `paypal-cert-url`. We don't chain-validate the cert; instead the
 *   URL must be https on a PayPal API host for this env and under `/v1/notifications/certs/`,
 *   fetched without following redirects. That allowlist is what makes this safe.
 *
 * Either way, verify against the *raw* request body bytes, before any JSON parsing.
 */
import type { PayPalEnv, Transport } from "../http";
import { VerifySignatureResponse } from "../schemas";
import { type KeyValueStore, memoryStore } from "../store";
import { base64ToBytes, crc32, parseCertificate } from "./crypto";

export interface WebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
}

export type HeaderSource = Headers | Record<string, string | undefined>;

export function readWebhookHeaders(h: HeaderSource): WebhookHeaders | null {
  const get = (k: string) => {
    if (h instanceof Headers) return h.get(k) ?? undefined;
    const hit = Object.entries(h).find(([key]) => key.toLowerCase() === k);
    return hit?.[1];
  };
  const transmissionId = get("paypal-transmission-id");
  const transmissionTime = get("paypal-transmission-time");
  const transmissionSig = get("paypal-transmission-sig");
  const certUrl = get("paypal-cert-url");
  const authAlgo = get("paypal-auth-algo");
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo)
    return null;
  return { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo };
}

export type VerifyFailure =
  | "missing_headers"
  | "unsupported_algorithm"
  | "cert_url_not_allowed"
  | "cert_fetch_failed"
  | "cert_invalid"
  | "cert_not_valid_now"
  | "stale_transmission"
  | "bad_signature"
  | "postback_failure";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

const CERT_HOSTS: Record<PayPalEnv, readonly string[]> = {
  sandbox: ["api.sandbox.paypal.com", "api-m.sandbox.paypal.com"],
  live: ["api.paypal.com", "api-m.paypal.com"],
};

export function isAllowedCertUrl(url: string, env: PayPalEnv): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    u.port === "" &&
    u.username === "" &&
    CERT_HOSTS[env].includes(u.hostname) &&
    u.pathname.startsWith("/v1/notifications/certs/")
  );
}

export interface SelfVerifyInput {
  env: PayPalEnv;
  /** The id of the webhook subscription this endpoint serves (from the dashboard / API). */
  webhookId: string;
  headers: HeaderSource;
  rawBody: string | Uint8Array;
  fetch?: typeof fetch;
  /** Caches cert PEMs by URL. Defaults to a per-module in-memory store. */
  certCache?: KeyValueStore;
  certTtlSeconds?: number;
  /** Reject transmissions older than this. Off by default: PayPal redelivers for up to 3 days. */
  maxAgeSeconds?: number;
  now?: () => number;
}

const defaultCertCache = memoryStore();

export async function verifyWebhookSelf(input: SelfVerifyInput): Promise<VerifyResult> {
  const h = readWebhookHeaders(input.headers);
  if (!h) return { ok: false, reason: "missing_headers" };
  if (h.authAlgo.toUpperCase() !== "SHA256WITHRSA")
    return { ok: false, reason: "unsupported_algorithm" };
  if (!isAllowedCertUrl(h.certUrl, input.env)) return { ok: false, reason: "cert_url_not_allowed" };
  const now = (input.now ?? Date.now)();
  if (input.maxAgeSeconds !== undefined) {
    const sent = Date.parse(h.transmissionTime);
    if (!Number.isFinite(sent) || now - sent > input.maxAgeSeconds * 1000) {
      return { ok: false, reason: "stale_transmission" };
    }
  }

  const cache = input.certCache ?? defaultCertCache;
  const cacheKey = `paypal:webhook-cert:${h.certUrl}`;
  let pem = await cache.get(cacheKey);
  const fetched = !pem;
  if (!pem) {
    try {
      const res = await (input.fetch ?? ((u, i) => fetch(u, i)))(h.certUrl, { redirect: "manual" });
      if (res.status !== 200) return { ok: false, reason: "cert_fetch_failed" };
      pem = await res.text();
    } catch {
      return { ok: false, reason: "cert_fetch_failed" };
    }
  }

  let key: CryptoKey;
  try {
    const cert = parseCertificate(pem);
    if (now < cert.notBefore || now > cert.notAfter)
      return { ok: false, reason: "cert_not_valid_now" };
    key = await crypto.subtle.importKey(
      "spki",
      cert.spki,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return { ok: false, reason: "cert_invalid" };
  }
  if (fetched) await cache.put(cacheKey, pem, { ttlSeconds: input.certTtlSeconds ?? 86_400 });

  const body =
    typeof input.rawBody === "string" ? new TextEncoder().encode(input.rawBody) : input.rawBody;
  const message = new TextEncoder().encode(
    `${h.transmissionId}|${h.transmissionTime}|${input.webhookId}|${crc32(body)}`,
  );
  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = base64ToBytes(h.transmissionSig);
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, message);
  return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
}

export interface PostbackVerifyInput {
  webhookId: string;
  headers: HeaderSource;
  rawBody: string;
}

export async function verifyWebhookPostback(
  t: Transport,
  input: PostbackVerifyInput,
): Promise<VerifyResult> {
  const h = readWebhookHeaders(input.headers);
  if (!h) return { ok: false, reason: "missing_headers" };
  let event: unknown;
  try {
    event = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, reason: "postback_failure" };
  }
  const res = await t.request({
    method: "POST",
    route: "/v1/notifications/verify-webhook-signature",
    path: "/v1/notifications/verify-webhook-signature",
    json: {
      auth_algo: h.authAlgo,
      cert_url: h.certUrl,
      transmission_id: h.transmissionId,
      transmission_sig: h.transmissionSig,
      transmission_time: h.transmissionTime,
      webhook_id: input.webhookId,
      webhook_event: event,
    },
    schema: VerifySignatureResponse,
    // A pure check with no side effects: safe to retry without an idempotency key.
    idempotent: true,
  });
  return res.verification_status === "SUCCESS"
    ? { ok: true }
    : { ok: false, reason: "postback_failure" };
}
