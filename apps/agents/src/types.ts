import type { Arm, Money } from "@pact/protocol";

export type ModelFamily = "gpt" | "gemini" | "sonnet";
export const MODEL_FAMILIES: ModelFamily[] = ["gpt", "gemini", "sonnet"];

export interface Listing {
  shopId: string;
  upc: string;
  brand: string;
  name: string;
  price: Money;
}

/** Shape returned by the catalogue's `search_product` tool. */
export interface SearchResult {
  listings: Listing[];
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

export interface CheckoutResult {
  orderId: string;
  shopId: string;
  upc: string;
  total: Money;
  captureId: string | null;
  status: string;
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
  storesViewed: string[];
  searches: number;
  product: { upc: string; name: string } | null;
  shop: string | null;
  orderId: string | null;
  captureId: string | null;
  total: Money | null;
  passportAttached: boolean;
  /** The agent's own stated reason for what it bought and where. */
  reason: string | null;
  status: "purchased" | "no_purchase" | "error";
  error?: string;
}

export interface Endpoints {
  catalogueUrl: string;
  catalogueFetch?: typeof fetch;
  shopsUrl: string;
  shopsFetch?: typeof fetch;
  /** Engine admin API; when set, every session is reported to it so lift sees the non-buyers. */
  engineUrl?: string;
  engineFetch?: typeof fetch;
}
