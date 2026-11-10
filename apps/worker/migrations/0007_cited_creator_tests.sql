-- Creator onboarding (/creators): creators who connected their own PayPal account, and the tests
-- they published. `source` tags them apart from the recorded demo's creators ('demo'), so the
-- catalogue and the eval numbers never pick them up by accident.
ALTER TABLE creators ADD COLUMN source TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE creators ADD COLUMN created_at TEXT;

CREATE TABLE creator_tests (
  test_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('test', 'placebo')),
  -- The test this placebo controls for (NULL on the test itself).
  pairs_with TEXT,
  category TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'onboarding',
  published_at TEXT NOT NULL
);
CREATE INDEX creator_tests_creator ON creator_tests (creator_id, published_at);
