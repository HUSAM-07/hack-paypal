-- Agent run records for the hosted demo console (one JSONL line from the demo runner per row).
CREATE TABLE cited_agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
