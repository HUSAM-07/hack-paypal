-- The self-dealing and abuse guard (@pact/attribution guard.ts).

-- Who paid: the PayPal payer id of the buyer's wallet, from CHECKOUT.ORDER.* (payer.payer_id).
ALTER TABLE orders ADD COLUMN payer_id TEXT;

-- Who runs the agent session, when the agent platform says so (a creator's own agent is not a
-- shopper: its sessions never enter the study).
ALTER TABLE agent_sessions ADD COLUMN owner_id TEXT;

-- Review flags gain an id and a status. Guard reasons (self_purchase, repeat_buyer, velocity,
-- refund_ring) on a pending credit are holds: while `open`, the credit is never paid. A
-- reviewer sets them `released` (paid at the next payout) or `voided` (the credit is voided).
ALTER TABLE review_flags ADD COLUMN id TEXT;
ALTER TABLE review_flags ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE review_flags ADD COLUMN detail TEXT;
ALTER TABLE review_flags ADD COLUMN created_at TEXT;
ALTER TABLE review_flags ADD COLUMN resolved_at TEXT;
UPDATE review_flags SET id = reason || ':' || credit_id WHERE id IS NULL;
CREATE UNIQUE INDEX review_flags_id ON review_flags (id);
CREATE INDEX review_flags_status ON review_flags (status, reason);
