import {
  createPayPal,
  type KeyValueStore,
  memoryStore,
  type PayPalClient,
  PayPalError,
} from "@pact/paypal";
import type { Env } from "../env";

export type PayPalMode = "simulated" | "sandbox" | "live";

export class PayPalNotConfigured extends Error {}

interface TestOverrides {
  fetch?: typeof fetch;
  mode?: PayPalMode;
}

let overrides: TestOverrides = {};

/**
 * Tests run the worker, its Durable Objects and the test file in one isolate, so a
 * module-level override reaches every PayPal call site without a binding per test.
 */
export function setPayPalTestOverrides(next: TestOverrides): void {
  overrides = next;
  clients.clear();
}

export function paypalMode(env: Env): PayPalMode {
  const mode = overrides.mode ?? env.PAYPAL_MODE;
  if (mode === "simulated" || mode === "sandbox" || mode === "live") return mode;
  throw new PayPalNotConfigured("unknown PAYPAL_MODE");
}

// One client per isolate keeps the app token cached across requests. Token and cert
// caches are per isolate; a cold isolate just mints a new token.
const clients = new Map<string, PayPalClient>();
export const certCache: KeyValueStore = memoryStore();

/** The PayPal client, or null in simulated mode. Throws when real mode lacks credentials. */
export function paypalFor(env: Env): PayPalClient | null {
  const mode = paypalMode(env);
  if (mode === "simulated") return null;
  const { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret } = env;
  if (!clientId || !clientSecret) throw new PayPalNotConfigured("PayPal credentials missing");
  const key = `${mode}:${clientId}`;
  let pp = clients.get(key);
  if (!pp) {
    pp = createPayPal({
      clientId,
      clientSecret,
      env: mode,
      ...(overrides.fetch ? { fetch: overrides.fetch, sleep: async () => {} } : {}),
      onRequest: (l) => {
        if (l.status >= 400) console.warn("paypal", l.method, l.route, l.status, l.debugId);
      },
    });
    clients.set(key, pp);
  }
  return pp;
}

/** Short, log- and UI-safe reason for a failed PayPal call (no ids, no bodies). */
export function failureReason(e: unknown): string {
  if (e instanceof PayPalError) return (e.issues[0] ?? e.code).slice(0, 80);
  return e instanceof Error ? e.message.slice(0, 80) : "paypal_error";
}
