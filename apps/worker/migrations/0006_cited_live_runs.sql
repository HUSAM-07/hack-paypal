-- Live agent runs from /try, kept apart from the demo's recorded runs (cited_agent_runs), so the
-- console's numbers never move. ip_hash is a salted hash, only used for the per-visitor limit.
CREATE TABLE cited_live_runs (
  id TEXT PRIMARY KEY,
  record TEXT NOT NULL,
  provider TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX cited_live_runs_ip ON cited_live_runs (ip_hash, created_at);
CREATE INDEX cited_live_runs_created ON cited_live_runs (created_at);
