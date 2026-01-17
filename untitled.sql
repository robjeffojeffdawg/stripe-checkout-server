SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'access_tokens'
ORDER BY ordinal_position;

ALTER TABLE access_tokens
  ADD COLUMN IF NOT EXISTS used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_uses INTEGER DEFAULT 5;

UPDATE access_tokens
SET created_at = NOW()
WHERE created_at IS NULL;

ALTER TABLE access_tokens
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE access_tokens
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE access_tokens
SET expires_at = NOW() + INTERVAL '30 days'
WHERE expires_at IS NULL;

ALTER TABLE access_tokens
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '30 days'),
  ALTER COLUMN expires_at SET NOT NULL;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'access_tokens'
ORDER BY ordinal_position;

INSERT INTO access_tokens (token, session_id, created_at, expires_at, used, max_uses)
VALUES ('test-token-123', 'test-session-123', NOW(), NOW() + INTERVAL '30 days', 0, 5);

SELECT token, session_id, created_at, expires_at, used, max_uses FROM access_tokens WHERE token = 'test-token-123';

DELETE FROM access_tokens WHERE token = 'test-token-123';
ALTER TABLE access_tokens
ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 5;
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'access_tokens'
ORDER BY column_name;
