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

  // Secrets / per-environment (.dev.vars or `wrangler secret put`).
  ANTHROPIC_API_KEY?: string;
  CHANNEL3_API_KEY?: string;
  SESSION_SECRET: string;
  RP_ID: string;
  /** Comma-separated origins allowed for WebAuthn and WebSocket upgrades. */
  ORIGINS: string;
  DEV_AUTH?: string;
}

export function allowedOrigins(env: Env): string[] {
  return env.ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
