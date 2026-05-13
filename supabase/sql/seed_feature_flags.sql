-- ─────────────────────────────────────────────────────────────
-- Feature flag baseline for 1stOne F1
-- Run in Supabase SQL editor once per fresh DB.
--
-- Client fallback: if a row is missing, useFeatureFlag returns the
-- per-call-site default (true for essentials_module_active and
-- referral_system; false for opt-in modules). Still, keep this
-- seed authoritative so Admin UI toggles have a row to flip.
-- ─────────────────────────────────────────────────────────────

INSERT INTO feature_flags (flag_key, flag_value, description) VALUES
  ('essentials_module_active',   TRUE,  'Home tab + Packing sub-tab for grocery items'),
  ('referral_system',            TRUE,  'Referral code generation, apply-referral, share links'),
  ('hub_delivery_active',        FALSE, 'Enables hub assignment on address save + hub flow on staff delivery tab'),
  ('branch_management_active',   FALSE, 'Multi-branch filtering for admin dashboards and write scoping'),
  ('storm_mode_active',          FALSE, 'Blocks new orders + subscription renewals across the store')
ON CONFLICT (flag_key) DO NOTHING;
