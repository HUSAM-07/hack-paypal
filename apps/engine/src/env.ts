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
  /** Bearer token for the API's writes (reads are public). */
  ENGINE_API_TOKEN?: string | undefined;
  /**
   * "1" lets writes through without a token when none is set. Only local dev, tests and the
   * worker's in-process callers set it; never a deployed config.
   */
  ENGINE_OPEN_API?: string | undefined;
  /** Who brand statements (Invoicing v2) are addressed to; default billing@<brandId>.example.com. */
  STATEMENT_RECIPIENT_EMAIL?: string | undefined;
}
