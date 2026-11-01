-- PayPal webhook plumbing. Event ids are claimed here (INSERT OR IGNORE is atomic, unlike
-- a KV get-then-put), and PayPal resource ids map back to the user/thread they belong to.
CREATE TABLE paypal_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- `ref` is an order, capture or payout batch id, or `vault:<sha256(vault id)>` (never the raw vault id).
CREATE TABLE paypal_refs (
  ref TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  thread_id TEXT,
  pact_id TEXT,
  payment_id TEXT,
  created_at TEXT NOT NULL
);
