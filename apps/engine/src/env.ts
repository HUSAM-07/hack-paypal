export interface Env {
  DB: D1Database;
  PAYPAL_MODE: string;
  MODEL_PROVIDER: string;
  /** HMAC key the catalogue signs Agent Affiliate Passports with. */
  PASSPORT_KEY?: string | undefined;
  /** Webhook subscription id; required unless PAYPAL_MODE=simulated. */
  PAYPAL_WEBHOOK_ID?: string | undefined;
  PAYPAL_CLIENT_ID?: string | undefined;
  PAYPAL_CLIENT_SECRET?: string | undefined;
  /** Bearer token for the admin and read API. Required unless PAYPAL_MODE=simulated. */
  ENGINE_API_TOKEN?: string | undefined;
}
