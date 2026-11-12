import type { CitedDemoDO } from "./do/cited-demo";
import type { PactDO } from "./do/pact";
import type { ThreadDO } from "./do/thread";
import type { UserDO } from "./do/user";

export interface Env {
  THREAD: DurableObjectNamespace<ThreadDO>;
  USER: DurableObjectNamespace<UserDO>;
  PACT: DurableObjectNamespace<PactDO>;
  /** One instance: the CITED demo's in-memory state (the agents' PayPal mock, catalogue clock). */
  CITED_DEMO: DurableObjectNamespace<CitedDemoDO>;
  DB: D1Database;
  /** The built web app (apps/web/dist). */
  ASSETS: Fetcher;
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
  /** When set, creating an account requires this code. Unset means open sign-up. */
  INVITE_CODE?: string;

  /**
   * "sandbox" | "live" call PayPal; "simulated" fakes charges locally so dev and tests
   * run without credentials. Anything else is treated as misconfiguration.
   */
  PAYPAL_MODE: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  /** The id PayPal assigned to our webhook subscription; signatures are bound to it. */
  PAYPAL_WEBHOOK_ID?: string;

  // CITED engine, mounted at /api/cited (see src/cited.ts).
  /** PayPal mode for CITED only; falls back to PAYPAL_MODE. */
  CITED_PAYPAL_MODE?: string;
  /** Webhook id for the /api/cited/webhooks/paypal subscription. */
  CITED_PAYPAL_WEBHOOK_ID?: string;
  /** HMAC key the catalogue signs Agent Affiliate Passports with. */
  CITED_PASSPORT_KEY?: string;
  /** Secret passport key for deployed sandbox/live; overrides the public CITED_PASSPORT_KEY. */
  CITED_PASSPORT_SECRET?: string;
  /** AG Grid Enterprise licence key for /studio; optional (watermark without it). */
  AG_GRID_LICENSE_KEY?: string;
  /** AG Studio licence (trial) key; unset = watermark. Ships to the browser. */
  AG_STUDIO_LICENSE_KEY?: string;
  /** Model for the Studio agents (default claude-sonnet-5-5). */
  CITED_STUDIO_MODEL?: string;
  /**
   * Bearer token for CITED writes from outside (engine write API, catalogue demo controls).
   * Unset means those writes are refused, unless CITED_OPEN_API opens them for local dev.
   */
  CITED_API_TOKEN?: string;
  /** "1" opens CITED writes keylessly while no token is set. .dev.vars and tests only. */
  CITED_OPEN_API?: string;
  /** Sandbox: the buyer's vaulted PayPal wallet the agents pay with (see AGENT-CHECKOUT.md). */
  CITED_BUYER_VAULT_ID?: string;
  /** Sandbox: each seller's PayPal account (merchant id or email), the orders' payee. */
  CITED_SELLER_NORTHWIND_PAYEE?: string;
  CITED_SELLER_LUMEN_PAYEE?: string;
  CITED_SELLER_MEGAMART_PAYEE?: string;

  // Live agent at /try (src/live). A gateway wins over Anthropic; neither means the scripted agent.
  /** OpenAI-compatible gateway for live runs (local dev, .dev.vars only). */
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  /** Model id for live runs; default claude-sonnet-5-5. */
  CITED_LIVE_MODEL?: string;
}

export function allowedOrigins(env: Env): string[] {
  return env.ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
