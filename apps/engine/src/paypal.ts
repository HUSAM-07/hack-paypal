import { createPayPalFromEnv, type PayPalFromEnv } from "@pact/paypal";
import type { Env } from "./env";

let cached: { key: string; value: PayPalFromEnv } | undefined;

/**
 * PayPal client for this isolate. In simulated mode the in-memory mock keeps its state
 * between requests, so the client is created once per (mode, credentials). It starts empty
 * whenever the isolate (or the demo Durable Object) restarts while D1 keeps the ledger; with
 * MOCK_IDS_FROM_CLOCK its ids start from the clock, since a restarted counter would reissue ids
 * (refunds, payout batches, deposit captures) that D1 already holds.
 */
export function getPayPal(env: Env): PayPalFromEnv {
  const key = `${env.PAYPAL_MODE}|${env.PAYPAL_CLIENT_ID ?? ""}`;
  if (!cached || cached.key !== key)
    cached = {
      key,
      value: createPayPalFromEnv(
        env,
        env.MOCK_IDS_FROM_CLOCK === "1" ? { mock: { idOffset: Date.now() } } : {},
      ),
    };
  return cached.value;
}
