/**
 * Shop contract: the product types every shop layer agrees on.
 *  - Tool names double as widget keys (`ToolCallItem.name` → widget in `@shop/genui`).
 *  - `ToolArgs[name]` is what the model sends; `ToolResults[name]` is what the widget renders.
 *  - `ShopState` is the user-scoped state the agent broadcasts via `state/snapshot|patch`.
 *  - `ShopActions` are widget buttons that run without a chat turn (`action/invoke`).
 *
 * Browser-safe: zod only, no runtime deps. Money is `Money {amountMinor, currency}`; the model
 * never types a price into the UI. Prices come from server results.
 *
 * Additive changes only once other layers build on it.
 */
import { Money } from "@shop/agent-protocol";
import { z } from "zod";

const Id = z.string().min(1).max(128);
const Timestamp = z.iso.datetime();
const Url = z.string().url().max(2048);

// ── Offers ──

export const Merchant = z.object({
  name: z.string().max(120),
  domain: z.string().max(253),
  /** Present when the seller takes PayPal through us: the only offers auto-buy can purchase. */
  paypalSellerId: z.string().max(64).optional(),
  logoUrl: Url.optional(),
});
export type Merchant = z.infer<typeof Merchant>;

export const Offer = z.object({
  id: Id,
  title: z.string().max(300),
  brand: z.string().max(120).optional(),
  imageUrl: Url.optional(),
  url: Url,
  merchant: Merchant,
  price: Money,
  /** Struck-through "was" price when the page shows one. */
  listPrice: Money.optional(),
  shipping: Money.optional(),
  inStock: z.boolean().optional(),
  rating: z
    .object({ value: z.number().min(0).max(5), count: z.number().int().nonnegative() })
    .optional(),
  /** Short page highlights (Exa) shown under the card; untrusted text, rendered as text only. */
  highlights: z.array(z.string().max(400)).max(5).default([]),
  /** True only for PayPal sellers: "Buy with PayPal" vs "Buy at merchant". */
  buyable: z.boolean(),
  source: z.enum(["paypalSeller", "exa", "web"]),
  seenAt: Timestamp,
});
export type Offer = z.infer<typeof Offer>;

export const Source = z.object({
  n: z.number().int().positive(),
  url: Url,
  title: z.string().max(300),
});
export type Source = z.infer<typeof Source>;

export const PriceCheck = z.object({
  offerId: Id.optional(),
  url: Url,
  price: Money,
  shipping: Money.optional(),
  inStock: z.boolean().optional(),
  variant: z.string().max(200).optional(),
  /** How it was read, cheapest first. */
  method: z.enum(["jsonLd", "exaContents", "browserRun", "paypalCatalogue"]),
  checkedAt: Timestamp,
});
export type PriceCheck = z.infer<typeof PriceCheck>;

// ── Watches and auto-buy ──

export const AutoBuyRule = z.object({
  /** Buy when the live unit price is at or below this. */
  maxUnitPrice: Money,
  /** Hard cap including shipping and tax. */
  maxTotal: Money,
  quantity: z.number().int().min(1).max(10).default(1),
  expiresAt: Timestamp,
  /** Policy mandate backing the rule (`@pact/policy`). Set once the user approves it. */
  mandateId: Id.optional(),
});
export type AutoBuyRule = z.infer<typeof AutoBuyRule>;

export const WatchStatus = z.enum([
  "active",
  "paused",
  /** Target hit; notified (watch-only) or checkout started (auto-buy). */
  "triggered",
  /** Something looked wrong (price too good, variant changed); waiting on the user. */
  "needsReview",
  "completed",
  "cancelled",
  "expired",
]);

export const Watch = z.object({
  id: Id,
  offer: Offer,
  /** Notify at or below this price. */
  targetPrice: Money,
  autoBuy: AutoBuyRule.optional(),
  status: WatchStatus,
  everyMinutes: z.number().int().min(5).max(1440),
  lastCheck: PriceCheck.optional(),
  nextCheckAt: Timestamp.optional(),
  /** Price history for the sparkline (minor units of `targetPrice.currency`). */
  history: z
    .array(z.object({ at: Timestamp, amountMinor: z.number().int().nonnegative() }))
    .max(500),
  reviewReason: z.string().max(300).optional(),
  threadId: Id.optional(),
  createdAt: Timestamp,
});
export type Watch = z.infer<typeof Watch>;

// ── Orders ──

export const OrderStatus = z.enum([
  /** PayPal authorization held; capture waits for the cooling-off window. */
  "coolingOff",
  "captured",
  /** Cancelled during cooling-off: authorization voided, no money moved. */
  "voided",
  "refunded",
  "partiallyRefunded",
  "failed",
]);

export const Order = z.object({
  id: Id,
  offer: Offer,
  quantity: z.number().int().min(1).max(10),
  total: Money,
  status: OrderStatus,
  coolingOffEndsAt: Timestamp.optional(),
  paypal: z.object({
    orderId: z.string().max(64),
    authorizationId: z.string().max(64).optional(),
    captureId: z.string().max(64).optional(),
  }),
  /** Set when an auto-buy rule placed it. */
  watchId: Id.optional(),
  failureReason: z.string().max(300).optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Order = z.infer<typeof Order>;

// ── Wallet ──

export const Wallet = z.object({
  connected: z.boolean(),
  /** Masked PayPal email or "PayPal ••••1234". The vault id never leaves the server. */
  label: z.string().max(120).optional(),
  connectedAt: Timestamp.optional(),
});
export type Wallet = z.infer<typeof Wallet>;

// ── User-scoped state (state/snapshot | state/patch) ──

export const ShopState = z.object({
  watches: z.array(Watch),
  orders: z.array(Order),
  wallet: Wallet,
  /** Default cooling-off window for purchases, in minutes (0 disables it). */
  coolingOffMinutes: z.number().int().min(0).max(1440),
  /** Above this total the approval needs a passkey step-up. */
  stepUpAbove: Money,
});
export type ShopState = z.infer<typeof ShopState>;

// ── Tools (name = widget key) ──

/** Exa's required objective description, verbatim (build-with-exa skill). */
export const EXA_OBJECTIVE_DESCRIPTION =
  "Goal for this search turn; say which documents should rank first, which should be excluded, and what specific facts or figures to pull from them.";

export const ToolArgs = {
  search_products: z.object({
    query: z.string().min(1).max(300),
    objective: z.string().min(1).max(600).describe(EXA_OBJECTIVE_DESCRIPTION),
    maxPrice: Money.optional(),
  }),
  compare_offers: z.object({ offerIds: z.array(Id).min(2).max(4) }),
  web_research: z.object({
    question: z.string().min(1).max(600),
    objective: z.string().min(1).max(600).describe(EXA_OBJECTIVE_DESCRIPTION),
  }),
  open_page: z.object({ url: Url }),
  check_price: z.object({ offerId: Id.optional(), url: Url.optional() }),
  create_watch: z.object({
    offerId: Id,
    targetPrice: Money,
    everyMinutes: z.number().int().min(5).max(1440).default(60),
    /** Proposes an auto-buy rule; becomes an `autoBuyRule` approval. PayPal sellers only. */
    autoBuy: AutoBuyRule.omit({ mandateId: true }).optional(),
  }),
  update_watch: z.object({
    watchId: Id,
    targetPrice: Money.optional(),
    everyMinutes: z.number().int().min(5).max(1440).optional(),
    status: z.enum(["active", "paused"]).optional(),
  }),
  cancel_watch: z.object({ watchId: Id }),
  list_watches: z.object({}),
  /** Always a `purchase` approval unless an approved auto-buy rule covers it. */
  buy_offer: z.object({ offerId: Id, quantity: z.number().int().min(1).max(10).default(1) }),
  list_orders: z.object({}),
  cancel_order: z.object({ orderId: Id }),
} as const;
export type ToolName = keyof typeof ToolArgs;
export const TOOL_NAMES = Object.keys(ToolArgs) as ToolName[];

export const ToolResults = {
  search_products: z.object({ offers: z.array(Offer), sources: z.array(Source) }),
  compare_offers: z.object({
    offers: z.array(Offer),
    rows: z.array(z.object({ label: z.string().max(80), values: z.array(z.string().max(200)) })),
    /** Offer id the agent recommends, if any; the card explains it in `reason`. */
    pick: Id.optional(),
    reason: z.string().max(400).optional(),
  }),
  web_research: z.object({ answer: z.string().max(6000), sources: z.array(Source) }),
  open_page: z.object({
    url: Url,
    title: z.string().max(300),
    excerpt: z.string().max(4000),
    sessionId: Id.optional(),
  }),
  check_price: PriceCheck,
  create_watch: z.object({ watch: Watch }),
  update_watch: z.object({ watch: Watch }),
  cancel_watch: z.object({ watch: Watch }),
  list_watches: z.object({ watches: z.array(Watch) }),
  buy_offer: z.object({ order: Order }),
  list_orders: z.object({ orders: z.array(Order) }),
  cancel_order: z.object({ order: Order }),
} as const satisfies Record<ToolName, z.ZodType>;
export type ToolResultOf<N extends ToolName> = z.infer<(typeof ToolResults)[N]>;
export type ToolArgsOf<N extends ToolName> = z.input<(typeof ToolArgs)[N]>;

// ── Widget actions (action/invoke, no chat turn) ──

export const ShopActions = {
  "watch.pause": z.object({ watchId: Id }),
  "watch.resume": z.object({ watchId: Id }),
  "watch.cancel": z.object({ watchId: Id }),
  "watch.approveReview": z.object({ watchId: Id }),
  /** Undo during cooling-off: void the authorization. */
  "order.cancel": z.object({ orderId: Id }),
  /** Skip the rest of the cooling-off window and capture now. */
  "order.captureNow": z.object({ orderId: Id }),
  "wallet.startConnect": z.object({}),
  "wallet.completeConnect": z.object({ setupTokenId: z.string().max(128) }),
  "wallet.disconnect": z.object({}),
  "settings.update": z.object({
    coolingOffMinutes: z.number().int().min(0).max(1440).optional(),
  }),
} as const;
export type ShopActionName = keyof typeof ShopActions;

// ── Approval details (ApprovalRequestItem.details) ──

export const PurchaseApprovalDetails = z.object({
  offer: Offer,
  quantity: z.number().int().min(1).max(10),
  total: Money,
  coolingOffMinutes: z.number().int().min(0).max(1440),
});
export const AutoBuyApprovalDetails = z.object({
  offer: Offer,
  rule: AutoBuyRule.omit({ mandateId: true }),
});
