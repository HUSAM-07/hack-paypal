-- A programme's own commission rate, in basis points. Every programme that existed before this
-- keeps the 8% it always paid.
ALTER TABLE brands ADD COLUMN commission_bps INTEGER NOT NULL DEFAULT 800;
