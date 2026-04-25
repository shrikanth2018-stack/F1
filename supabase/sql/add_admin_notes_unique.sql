-- 1stOne F1 — Unique constraint for admin_notes upsert
--
-- The admin Note to Staff flow upserts by (target_tab, branch_id). Without
-- this constraint the upsert errors with "no unique or exclusion constraint
-- matching the ON CONFLICT specification".
--
-- NULLS NOT DISTINCT treats NULL branch_id values as equal — so the single-
-- branch / super-admin setup still has one row per target_tab.
-- Requires Postgres 15+ (Supabase default).
--
-- Run once in Supabase SQL editor.

ALTER TABLE admin_notes
  ADD CONSTRAINT admin_notes_target_branch_unique
  UNIQUE NULLS NOT DISTINCT (target_tab, branch_id);
