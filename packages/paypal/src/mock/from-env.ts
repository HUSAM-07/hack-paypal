/**
 * The `PAYPAL_MODE` toggle. `simulated` (the default, no keys needed) talks to the
 * in-memory mock; `sandbox` builds the unchanged real client.
 */
import { createPayPal, type PayPalClient } from "../client";
import type { PayPalConfig } from "../http";
import { createMockPayPal, type MockPayPal, type MockPayPalOptions } from "./paypal-mock";

export type PayPalMode = "simulated" | "sandbox";

export interface PayPalModeEnv {
  PAYPAL_MODE?: string | undefined;
  PAYPAL_CLIENT_ID?: string | undefined;
  PAYPAL_CLIENT_SECRET?: string | undefined;
}

export function payPalModeFromEnv(env: PayPalModeEnv): PayPalMode {
  const m = env.PAYPAL_MODE ?? "simulated";
  if (m === "simulated" || m === "sandbox") return m;
  throw new TypeError(`PAYPAL_MODE must be "simulated" or "sandbox", got "${m}"`);
}

export interface PayPalFromEnv {
  mode: PayPalMode;
  paypal: PayPalClient;
  /** Present only in simulated mode: register webhooks, approve orders, open disputes. */
  mock?: MockPayPal;
}

export function createPayPalFromEnv(
  env: PayPalModeEnv,
  opts: { mock?: MockPayPalOptions; client?: Partial<PayPalConfig> } = {},
): PayPalFromEnv {
  const mode = payPalModeFromEnv(env);
  if (mode === "sandbox") {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      throw new TypeError("PAYPAL_MODE=sandbox needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET");
    }
    return {
      mode,
      paypal: createPayPal({
        clientId: env.PAYPAL_CLIENT_ID,
        clientSecret: env.PAYPAL_CLIENT_SECRET,
        env: "sandbox",
        ...opts.client,
      }),
    };
  }
  const mock = createMockPayPal({ autoSettlePayouts: true, ...opts.mock });
  return {
    mode,
    mock,
    paypal: createPayPal({
      clientId: "mock-client-id",
      clientSecret: "mock-client-secret",
      env: "sandbox",
      ...opts.client,
      fetch: mock.fetch,
    }),
  };
}
