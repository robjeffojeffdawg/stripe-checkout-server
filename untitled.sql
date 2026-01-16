CREATE TABLE access_tokens (
  token TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0
);

SELECT current_database();
SELECT table_name FROM information_schema.tables WHERE table_schema='public';

CREATE TABLE access_tokens (
  token TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0
);
SELECT * FROM access_tokens;
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
