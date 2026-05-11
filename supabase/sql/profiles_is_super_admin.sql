-- ─────────────────────────────────────────────────────────────
-- 1stOne F1 — FT-05: explicit super-admin marker
--
-- Adds profiles.is_super_admin BOOLEAN (NOT NULL, DEFAULT FALSE)
-- and backfills it from the current implicit signal
-- (role='admin' AND branch_id IS NULL).
--
-- Replaces the convention "super-admin = admin without a branch"
-- with an explicit flag. After this lands:
--   - is_super_admin() RLS function reads JWT claim (fast path) or
--     the column (fallback for stale JWTs / in-DB callers).
--   - custom_access_token_hook injects is_super_admin into JWT.
--   - elevate-employee + seed_admin_head_designation +
--     fix_employee_profile_admin_writes all read the explicit
--     column instead of computing from a null branch_id.
--
-- Side-effect of the explicit marker: a super-admin can now
-- ALSO carry a home branch_id (e.g. owner who oversees branch 1)
-- without losing global powers — previously unrepresentable.
--
-- Idempotent — safe to re-run.
-- Run via Supabase Dashboard → SQL Editor BEFORE the updated
-- is_super_admin()/custom_access_token_hook are deployed.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: flip every current admin row that matches the legacy
-- "no branch" convention. Naturally idempotent — re-running sets
-- the same rows to TRUE again, no-op.
UPDATE public.profiles
   SET is_super_admin = TRUE
 WHERE role = 'admin'
   AND branch_id IS NULL
   AND is_super_admin = FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_is_super_admin
  ON public.profiles(is_super_admin)
  WHERE is_super_admin = TRUE;
