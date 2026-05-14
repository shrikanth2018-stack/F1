-- ─────────────────────────────────────────────────────────────
-- profiles.branch_id FK to branches(id)
--
-- Customers, staff, admins all carry an optional branch_id that
-- scopes them to a branch when branch_management_active is on.
-- The column existed (added in add_branch_id_columns_mf03.sql)
-- but never had an FK back to branches — leaving open the door
-- to an invalid branch_id slipping in through a misbehaving
-- write path.
--
-- Adjacent-pattern parity: customer_addresses.branch_id is
-- already FK-constrained; profiles.branch_id wasn't. Flagged
-- 2026-05-12; applied 2026-05-14 after orphan check returned
-- zero rows.
--
-- Run in Supabase SQL editor. Idempotent (guarded on
-- pg_constraint).
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_branch_id_fkey'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES branches(id);
  END IF;
END $$;
