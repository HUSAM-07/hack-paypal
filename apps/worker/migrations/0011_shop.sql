-- Shop vertical (shop/spec/SHOP-SPEC.md). Global indexes only: threads, watches, mandates and
-- wallet refs live in each user's ShopperAgent Durable Object. Additive: no existing table changes.
--
-- Timestamps are ISO-8601 UTC strings from Date#toISOString(), as the shop contract uses, so
-- text order is time order and range queries on them are correct. Status columns hold the
-- contract's enums (WatchStatus, OrderStatus in packages/commerce/src/contract.ts) without a
-- CHECK, so an additive enum value doesn't need a table rebuild.

-- Third-party sign-in identities linked to a user (Google today). `sub` is the provider's
-- stable subject id; the email is kept for display and support only, never to match accounts.
CREATE TABLE shop_oauth_accounts (
  provider TEXT NOT NULL,
  sub TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, sub)
);
CREATE INDEX shop_oauth_accounts_by_user ON shop_oauth_accounts(user_id);

-- One row per watch, written by its ShopperAgent, so the cron sweep can find watches whose
-- alarm was missed without waking every user's Durable Object.
CREATE TABLE shop_watch_index (
  watch_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  next_check_at TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX shop_watch_index_due ON shop_watch_index(status, next_check_at);
CREATE INDEX shop_watch_index_by_user ON shop_watch_index(user_id);

-- Mirror of each shop order's PayPal ids, so a PayPal webhook (which carries only PayPal ids)
-- can find the user's Durable Object, and the sweep can find authorizations near expiry.
CREATE TABLE shop_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  watch_id TEXT,
  paypal_order_id TEXT NOT NULL UNIQUE,
  paypal_authorization_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  status TEXT NOT NULL,
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  cooling_off_ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX shop_orders_by_user ON shop_orders(user_id, created_at);
CREATE INDEX shop_orders_cooling_off ON shop_orders(status, cooling_off_ends_at);
