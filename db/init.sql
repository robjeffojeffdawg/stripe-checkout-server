CREATE TABLE access_tokens (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 5

  ALTER TABLE users
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users
ADD COLUMN stripe_payment_method_id TEXT;

);