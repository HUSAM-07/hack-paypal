-- Creators can be paid to Venmo instead of PayPal. `paypal_id` stays (it is the creator's PayPal
-- payer id and still backs the abuse guard); these columns only choose where a payout goes.
-- Every existing creator stays on PayPal by default, so no demo number moves.
ALTER TABLE creators ADD COLUMN payout_wallet TEXT NOT NULL DEFAULT 'PAYPAL';
ALTER TABLE creators ADD COLUMN venmo_receiver TEXT;
ALTER TABLE creators ADD COLUMN venmo_receiver_type TEXT;
