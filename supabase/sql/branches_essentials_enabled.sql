-- 1stOne F1 — Move essentials offering from global feature flag to per-branch
--
-- Today essentials_module_active is a single global feature_flags row — one
-- truth for the whole system. The owner needs per-branch control ("Branch A
-- offers essentials, Branch B doesn't") which a global flag can't express.
--
-- This migration adds a per-branch column; the new useEssentialsEnabled
-- client hook reads it via the customer/admin/staff branch resolution. The
-- backfill seeds every existing branch with the current global flag value
-- so day-0 behaviour is identical and no customer sees a sudden change.
--
-- The legacy feature_flags.essentials_module_active row stays for one
-- release as a safety net (so a rollback of the client doesn't strand a
-- customer with no module). FeatureFlagsScreen will hide the toggle.

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS essentials_enabled BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.branches
SET essentials_enabled = COALESCE(
  (SELECT flag_value FROM public.feature_flags WHERE flag_key = 'essentials_module_active'),
  TRUE
);

-- Force PostgREST schema-cache reload so the new column is selectable.
NOTIFY pgrst, 'reload schema';
