import { createPayPalFromEnv, type PayPalFromEnv } from "@pact/paypal";
import type { Env } from "./env";

let cached: { key: string; value: PayPalFromEnv } | undefined;

/**
 * PayPal client for this isolate. In simulated mode the in-memory mock keeps its state
 * between requests, so the client is created once per (mode, credentials).
 */
export function getPayPal(env: Env): PayPalFromEnv {
  const key = `${env.PAYPAL_MODE}|${env.PAYPAL_CLIENT_ID ?? ""}`;
  if (!cached || cached.key !== key) cached = { key, value: createPayPalFromEnv(env) };
  return cached.value;
}
