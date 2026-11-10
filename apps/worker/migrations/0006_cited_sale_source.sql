-- Where a sale came from. `mcp`: an agent shopping through the public MCP endpoint (/mcp), whose
-- passport session id starts with `mcp_`. Those sales are recorded and shown on their own, but
-- never enter the study, the credit ledger or the console's numbers.
ALTER TABLE sales ADD COLUMN source TEXT NOT NULL DEFAULT 'agent';
CREATE INDEX sales_source ON sales (source, captured_at);
