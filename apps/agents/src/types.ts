import type { Arm, Money } from "@pact/protocol";

export type ModelFamily = "gpt" | "gemini" | "sonnet";
export const MODEL_FAMILIES: ModelFamily[] = ["gpt", "gemini", "sonnet"];

export interface SellerRef {
  id: string;
  name: string;
  /** The seller's PayPal account: the order's `payee`. */
  payee: { merchant_id?: string; email_address?: string };
}

/** One product at one seller, as the catalogue's `search_product` returns it. */
export interface Offer {
  offerId: string;
  upc: string;
  brand: string;
  name: string;
  specs: string;
  seller: SellerRef;
  price: Money;
}

/** Shape returned by the catalogue's `search_product` tool. */
export interface SearchResult {
  offers: Offer[];
  creatorContent: {
    id: string;
    kind: "test" | "placebo";
    creatorId: string;
    summary: string;
    verdictUpc?: string;
    disclosure: string;
  }[];
  passport: string;
}

/** Shape returned by the catalogue's `checkout` tool. */
export interface CheckoutResult {
  orderId: string;
  captureId: string | null;
  status: string;
  offerId: string;
  upc: string;
  seller: SellerRef;
  total: Money;
  customId: string | null;
}

/** One structured log line per session. */
export interface RunRecord {
  sessionId: string | null;
  runIndex: number;
  seed: string;
  request: string;
  family: ModelFamily;
  /** Model id actually used; `fake-<family>` under MODEL_PROVIDER=fake. */
  model: string;
  provider: "fake" | "openai-compatible";
  arm: Arm | null;
  creatorsSeen: string[];
  /** Sellers whose offers the agent looked at (passport `storesViewed`). */
  storesViewed: string[];
  searches: number;
  product: { upc: string; name: string } | null;
  /** Seller the agent paid (the order's payee), by id. */
  seller: string | null;
  sellerName: string | null;
  orderId: string | null;
  captureId: string | null;
  total: Money | null;
  /** How the agent paid: the PayPal wallet the buyer linked to it. */
  paidWith: "vaulted_paypal" | null;
  passportAttached: boolean;
  /** The agent's own stated reason for what it bought and from whom. */
  reason: string | null;
  status: "purchased" | "no_purchase" | "error";
  error?: string;
}

export interface Endpoints {
  /** The catalogue MCP: offers, and the agent platform's PayPal checkout. */
  catalogueUrl: string;
  catalogueFetch?: typeof fetch;
  /** Engine admin API; when set, every session is reported to it so lift sees the non-buyers. */
  engineUrl?: string;
  engineFetch?: typeof fetch;
}
