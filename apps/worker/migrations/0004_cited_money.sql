-- Programmes, deposits, credits, payouts, cycle refunds and the demo clock.

-- Session facts the lift needs for every session, not only the ones that bought.
ALTER TABLE agent_sessions ADD COLUMN arm TEXT;
ALTER TABLE agent_sessions ADD COLUMN category TEXT;
ALTER TABLE agent_sessions ADD COLUMN creators_seen TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_sessions ADD COLUMN stores_viewed TEXT NOT NULL DEFAULT '[]';
CREATE INDEX agent_sessions_category ON agent_sessions (category, arm);

-- A brand's SKU in a category programme. Funding buys measurement, never rank.
CREATE TABLE brands (
  brand_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  upc TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD'
);

-- Creator PayPal accounts (PAYPAL_ID payouts).
CREATE TABLE creators (
  creator_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  paypal_id TEXT
);

-- Prices the catalogue showed per store, for "price saved" on a journey.
CREATE TABLE listings (
  shop_id TEXT NOT NULL,
  upc TEXT NOT NULL,
  price_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  PRIMARY KEY (shop_id, upc)
);

-- One row per Orders v2 capture that funded a programme (initial deposit or cap top-up).
CREATE TABLE deposits (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('initial', 'topup')),
  idem_key TEXT NOT NULL,
  order_id TEXT NOT NULL,
  capture_id TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  returned_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('created', 'captured')),
  created_at TEXT NOT NULL,
  UNIQUE (brand_id, idem_key)
);

-- The ledger. Partial refunds split a credit into a pending rest and a voided `~vN` part.
CREATE TABLE credits (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  upc TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'voided', 'paid')),
  void_reason TEXT,
  hold_until TEXT NOT NULL,
  payout_batch_id TEXT,
  payout_status TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX credits_capture ON credits (capture_id);
CREATE INDEX credits_creator ON credits (creator_id, state);

-- Paid credits whose sale was refunded or disputed afterwards. A person reviews these.
CREATE TABLE review_flags (
  credit_id TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  payout_batch_id TEXT,
  PRIMARY KEY (credit_id, reason)
);

-- One row per Payouts batch we send. sender_batch_id is deterministic (hash of the credit ids).
CREATE TABLE payout_batches (
  sender_batch_id TEXT PRIMARY KEY,
  paypal_batch_id TEXT,
  status TEXT NOT NULL,
  items_json TEXT NOT NULL,
  credit_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Unspent deposit returned to a brand through captures/{id}/refund.
CREATE TABLE deposit_refunds (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  deposit_id TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Demo clock: one row; absent means the real clock.
CREATE TABLE clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  now TEXT NOT NULL
);
