-- Webhook intake and the arm-checkout join. Event ids are claimed with INSERT OR IGNORE
-- (atomic, unlike a get-then-put), so redeliveries are no-ops.
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- Agent session facts the passport does not carry (model family). Written by the catalogue.
CREATE TABLE agent_sessions (
  session_id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Approved orders, kept so a later capture (whose webhook has no line items) can be joined.
CREATE TABLE orders (
  order_id TEXT PRIMARY KEY,
  custom_id TEXT,
  shop_id TEXT NOT NULL,
  items_json TEXT NOT NULL,
  approved_at TEXT NOT NULL
);

-- One row per (capture, upc). Unattributed rows keep session_id/arm NULL and say why:
-- a bad or missing passport is never guessed at.
CREATE TABLE sales (
  capture_id TEXT NOT NULL,
  upc TEXT NOT NULL,
  order_id TEXT NOT NULL,
  shop_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  session_id TEXT,
  arm TEXT,
  creators_seen TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  captured_at TEXT NOT NULL,
  unattributed_reason TEXT,
  PRIMARY KEY (capture_id, upc)
);
CREATE INDEX sales_session ON sales (session_id);

-- Refunds and disputes, keyed to the capture so the ledger can void credits.
CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('refund', 'dispute')),
  status TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT,
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX refunds_capture ON refunds (capture_id);
