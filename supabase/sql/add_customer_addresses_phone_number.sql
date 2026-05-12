-- ─────────────────────────────────────────────────────────────
-- customer_addresses.phone_number
--
-- Per-address delivery contact phone. Prefilled from the
-- account holder's login phone at form-render time, editable
-- so customers can put a different receiver's number on each
-- address (Mom's place, office, gift drop, etc.).
--
-- Legacy rows: backfilled from profiles.phone_number.
-- Existing reads already do
--   address?.phone_number || order.profiles?.phone_number
-- so the profile fallback chain keeps working for any row
-- that ends up NULL.
--
-- Run in Supabase SQL editor. Idempotent.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

UPDATE customer_addresses ca
SET phone_number = p.phone_number
FROM profiles p
WHERE ca.user_id = p.id
  AND ca.phone_number IS NULL;
