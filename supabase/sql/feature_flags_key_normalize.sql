-- ─────────────────────────────────────────────────────────────
-- Feature flag key normalization (BF-45, 2026-05-12)
--
-- DB drift: feature_flags rows used pre-_active naming (e.g. 'branch_management',
-- 'storm_mode', 'hub_delivery') while every code lookup + seed_feature_flags.sql
-- + has_branch_access RLS function + place-order edge fn used the canonical
-- _active-suffixed names. Result: every useFeatureFlag call returned the
-- per-call-site default (false / true) instead of the stored value. RLS
-- has_branch_access evaluated to "permissive" because its lookup of
-- 'branch_management_active' returned NULL.
--
-- This script renames the six drifted keys to canonical names. Two values
-- are flipped FALSE pre-rename to preserve current behavior post-rename:
--
--   branch_management → branch_management_active
--     Was TRUE in DB but ignored by has_branch_access (key mismatch).
--     Flipping to FALSE preserves the current pre-launch permissive RLS
--     state. The V-06 launch flip will set it back to TRUE.
--
--   storm_mode → storm_mode_active
--     Was TRUE in DB but ignored by place-order edge fn (key mismatch).
--     Flipping to FALSE prevents place-order from immediately rejecting
--     all orders the moment the rename matches the lookup.
--
-- The other four are renamed at their existing values (TRUE):
--   essentials_module     → essentials_module_active   (TRUE, was default-TRUE anyway)
--   hub_delivery          → hub_delivery_active        (TRUE, activates hub flow as intended)
--   referral_program      → referral_system            (TRUE, was default-TRUE anyway)
--   route_pdf             → route_pdf_generation       (TRUE, no code reads it today)
--
-- loyalty_program already matches canonical — untouched.
-- Single transaction so partial state never surfaces.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- Pre-rename safety flips
UPDATE feature_flags SET flag_value = FALSE
  WHERE flag_key IN ('branch_management', 'storm_mode');

-- Renames
UPDATE feature_flags SET flag_key = 'essentials_module_active' WHERE flag_key = 'essentials_module';
UPDATE feature_flags SET flag_key = 'referral_system'          WHERE flag_key = 'referral_program';
UPDATE feature_flags SET flag_key = 'hub_delivery_active'      WHERE flag_key = 'hub_delivery';
UPDATE feature_flags SET flag_key = 'branch_management_active' WHERE flag_key = 'branch_management';
UPDATE feature_flags SET flag_key = 'route_pdf_generation'     WHERE flag_key = 'route_pdf';
UPDATE feature_flags SET flag_key = 'storm_mode_active'        WHERE flag_key = 'storm_mode';

COMMIT;
