-- Global indexes only. Per-thread and per-user state lives in Durable Object SQLite.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Pending WebAuthn ceremonies (register/login). Single use, short-lived.
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('register', 'login')),
  challenge TEXT NOT NULL,
  user_id TEXT,
  username TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('solo', 'group')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE thread_members (
  thread_id TEXT NOT NULL REFERENCES threads(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX thread_members_by_user ON thread_members(user_id);
