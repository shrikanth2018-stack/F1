-- ─────────────────────────────────────────────────────────────
-- Idempotency Keys Table for 1stOne F1
-- Run in Supabase SQL editor before deploying Edge Functions
-- ─────────────────────────────────────────────────────────────

-- Stores processed idempotency keys so duplicate requests are rejected
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES profiles(id),
  endpoint    TEXT NOT NULL,           -- e.g. 'place-order', 'subscribe'
  response    JSONB,                   -- cached response to return on replay
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-expire keys after 24 hours (prevent table bloat)
-- Requires pg_cron extension (enabled in Supabase by default)
SELECT cron.schedule(
  'expire-idempotency-keys',
  '0 * * * *',   -- every hour
  $$DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours'$$
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user ON idempotency_keys(user_id);
