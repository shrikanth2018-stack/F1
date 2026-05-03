-- ─────────────────────────────────────────────────────────────
-- Schema gap migration: customer_addresses zone/hub/serviceable
--
-- These three columns exist on the live production DB (they were
-- added at some point without a committed migration file) and are
-- written by AddAddressScreen and read by serviceability/hub-routing
-- logic. Without this file, a fresh DB rebuild from supabase/sql/
-- would produce a schema that doesn't match production — breaking
-- both the existing AddAddressScreen flow and the new
-- complete_onboarding_atomic RPC.
--
-- This migration is fully idempotent (ADD COLUMN IF NOT EXISTS +
-- DO-block constraint guards), so running it against the live DB
-- is a no-op.
--
-- Run in Supabase SQL editor. Safe to run multiple times.
-- ─────────────────────────────────────────────────────────────

-- 1. Columns ──────────────────────────────────────────────────

ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS zone_id        INTEGER,
  ADD COLUMN IF NOT EXISTS hub_id         INTEGER,
  ADD COLUMN IF NOT EXISTS is_serviceable BOOLEAN;

-- 2. Foreign keys (added separately so a re-run is a no-op) ───

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_addresses_zone_id_fkey'
  ) THEN
    ALTER TABLE customer_addresses
      ADD CONSTRAINT customer_addresses_zone_id_fkey
      FOREIGN KEY (zone_id) REFERENCES delivery_zones(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_addresses_hub_id_fkey'
  ) THEN
    ALTER TABLE customer_addresses
      ADD CONSTRAINT customer_addresses_hub_id_fkey
      FOREIGN KEY (hub_id) REFERENCES delivery_hubs(id);
  END IF;
END;
$$;

-- 3. Helpful indexes for serviceability queries ───────────────

CREATE INDEX IF NOT EXISTS idx_addresses_zone ON customer_addresses(zone_id);
CREATE INDEX IF NOT EXISTS idx_addresses_hub  ON customer_addresses(hub_id);
