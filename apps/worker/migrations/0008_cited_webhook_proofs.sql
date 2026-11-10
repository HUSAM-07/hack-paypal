-- Webhook deliveries whose PayPal signature verified against PayPal's own signing cert.
-- Proof only: the hosted demo runs on simulated PayPal, so these never touch sales, lift,
-- credits or payouts there. signed_for says what the signature binds to: our subscription id
-- ("subscription") or the literal id PayPal's webhook simulator signs with ("simulator").
-- Keyed by transmission: the simulator reuses fixed event ids, but every delivery is a new
-- signed transmission.
CREATE TABLE webhook_proofs (
  transmission_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  signed_for TEXT NOT NULL,
  verified INTEGER NOT NULL,
  transmission_time TEXT NOT NULL,
  cert_url TEXT NOT NULL,
  resource_id TEXT,
  dispatched INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
