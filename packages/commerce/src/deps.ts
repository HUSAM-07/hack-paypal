/**
 * Everything commerce needs from the outside world, injected. Nothing in this package reads a
 * Cloudflare global or `process.env`; `apps/shop` builds a `CommerceDeps` from its bindings.
 *
 * | dep         | backed by (worker)                                              |
 * |-------------|-----------------------------------------------------------------|
 * | `exa`       | `createExaClient({ apiKey: env.EXA_API_KEY })`                  |
 * | `fetch`     | global `fetch` (plain page reads for JSON-LD)                   |
 * | `browserRun`| optional: Browser Run `/json` (`env.BROWSER` or REST + token)   |
 * | `paypal`    | `createPayPalFromEnv(env)` (PAYPAL_MODE / CLIENT_ID / SECRET),  |
 * |             | or `createShopPayPalSim()` for `PAYPAL_MODE=simulated`          |
 * | `sellers`   | `paypalSellerSource()` (seeded) → later CITED catalogue-mcp     |
 * | `clock`     | `Date.now` (demo clock in tests / demo runner)                  |
 * | `ids`       | `crypto.randomUUID` based                                       |
 * | `kv`        | optional `SHOP_CACHE` KV namespace (price-check cache)          |
 */
import type { KeyValueStore, PayPalClient } from "@pact/paypal";
import type { BrowserRunClient } from "./browser-run";
import type { ExaClient } from "./exa";
import type { OfferSource } from "./sellers";

export interface Clock {
  now(): Date;
}

export interface Ids {
  /** A fresh unique id with a readable prefix (`ord`, `wat`, `man`…). */
  next(prefix: string): string;
}

export interface CommerceConfig {
  /** Where PayPal sends the buyer after approving the wallet link (vault setup token). */
  walletReturnUrl: string;
  walletCancelUrl: string;
  /** Live re-checks are cached this long in `kv` (seconds). Default 120. */
  priceCacheSeconds?: number;
  /** Brand shown on the PayPal approval page. */
  brandName?: string;
}

export interface CommerceDeps {
  exa: ExaClient;
  fetch: typeof fetch;
  browserRun?: BrowserRunClient;
  paypal: PayPalClient;
  sellers: OfferSource;
  clock: Clock;
  ids: Ids;
  kv?: KeyValueStore;
  config: CommerceConfig;
}

export const systemClock: Clock = { now: () => new Date() };

export const randomIds: Ids = {
  next: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
};

/** Deterministic ids for tests and the scripted demo. */
export function sequentialIds(): Ids {
  const counters = new Map<string, number>();
  return {
    next(prefix) {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}_${String(n).padStart(4, "0")}`;
    },
  };
}

/** A clock tests and the demo can move forward. */
export function manualClock(start: Date | string): Clock & {
  set(at: Date | string): void;
  advance(ms: number): void;
} {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    set: (at) => {
      t = new Date(at).getTime();
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

/** A failure the agent can explain to the user. `code` is stable; `message` is safe to show. */
export class ShopError extends Error {
  override readonly name = "ShopError";
  constructor(
    readonly code: ShopErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ShopErrorCode =
  | "not_found"
  | "offer_not_buyable"
  | "wallet_not_connected"
  | "approval_required"
  | "step_up_required"
  | "mandate_denied"
  | "currency_mismatch"
  | "price_unavailable"
  | "invalid_state"
  | "invalid_url"
  | "upstream";
