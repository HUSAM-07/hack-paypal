import type { PactDO } from "./do/pact";
import type { ThreadDO } from "./do/thread";
import type { UserDO } from "./do/user";

export interface Env {
  THREAD: DurableObjectNamespace<ThreadDO>;
  USER: DurableObjectNamespace<UserDO>;
  PACT: DurableObjectNamespace<PactDO>;
  DB: D1Database;
  IP_LIMITER: RateLimit;
  USER_LIMITER: RateLimit;

  MODEL_PROVIDER: string;
  MODEL_ID: string;
  RP_NAME: string;
  STEP_UP_ABOVE_MINOR: string;
  /** IANA zone for "Now" and local defaults (tomorrow 9am); America/Los_Angeles if unset. */
  TIMEZONE?: string;

  // Secrets / per-environment (.dev.vars or `wrangler secret put`).
  ANTHROPIC_API_KEY?: string;
  CHANNEL3_API_KEY?: string;
  SESSION_SECRET: string;
  RP_ID: string;
  /** Comma-separated origins allowed for WebAuthn and WebSocket upgrades. */
  ORIGINS: string;
  DEV_AUTH?: string;

  /**
   * "sandbox" | "live" call PayPal; "simulated" fakes charges locally so dev and tests
   * run without credentials. Anything else is treated as misconfiguration.
   */
  PAYPAL_MODE: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  /** The id PayPal assigned to our webhook subscription; signatures are bound to it. */
  PAYPAL_WEBHOOK_ID?: string;
}

export function allowedOrigins(env: Env): string[] {
  return env.ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
