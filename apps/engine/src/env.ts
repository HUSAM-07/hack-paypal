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
  /**
   * "1": simulated PayPal ids start from the clock. Set by pact-worker, whose demo Durable Object
   * restarts with an empty mock while D1 keeps the ledger. Unset (dev, tests), ids start at 0 so
   * a replay with the same seed is byte-identical.
   */
  MOCK_IDS_FROM_CLOCK?: string | undefined;
}
