-- Brand statements: one PayPal Invoicing v2 invoice per brand per cycle close, marked paid
-- against the prepaid deposit so nothing is due. The amounts are the ledger's at close time.
CREATE TABLE brand_statements (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_id TEXT,
  status TEXT NOT NULL,
  currency TEXT NOT NULL,
  credited_minor INTEGER NOT NULL,
  voided_minor INTEGER NOT NULL,
  paid_minor INTEGER NOT NULL,
  returned_minor INTEGER NOT NULL,
  deposited_minor INTEGER NOT NULL,
  reserved_minor INTEGER NOT NULL,
  invoice_total_minor INTEGER,
  invoice_paid_minor INTEGER,
  invoice_due_minor INTEGER,
  lines_json TEXT NOT NULL,
  payout_batch_ids_json TEXT NOT NULL,
  refund_ids_json TEXT NOT NULL,
  credit_ids_json TEXT NOT NULL,
  recipient_view_url TEXT,
  invoicer_view_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX brand_statements_brand ON brand_statements (brand_id);
