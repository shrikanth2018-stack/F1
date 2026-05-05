-- ─────────────────────────────────────────────────────────────
-- 1stOne F1 — MF-03 Commit 1: branch_id columns + indexes
--
-- Adds nullable branch_id columns (FK → branches.id) on the six
-- tables identified in docs/MF-03_multi_branch_audit.md as missing
-- branch scoping. Companion BTREE indexes follow the existing naming
-- convention (e.g. staff_attendance / expense_claims shape).
--
-- Idempotent — safe to re-run (IF NOT EXISTS on every clause).
-- DEFAULT NULL keeps historical rows valid; backfill + RLS branch-
-- scoping land in later MF-03 commits.
--
-- Run via Supabase Dashboard → SQL Editor. Run before the rest of
-- the MF-03 sequence (no other migration depends on it yet, but
-- subsequent commits assume these columns + indexes are present).
-- ─────────────────────────────────────────────────────────────

ALTER TABLE customer_addresses           ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) DEFAULT NULL;
ALTER TABLE user_subscriptions           ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) DEFAULT NULL;
ALTER TABLE cancelled_subscription_days  ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) DEFAULT NULL;
ALTER TABLE staff_leaves                 ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) DEFAULT NULL;
ALTER TABLE staff_salary                 ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) DEFAULT NULL;
ALTER TABLE staff_shifts                 ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_addresses_branch          ON customer_addresses(branch_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_branch          ON user_subscriptions(branch_id);
CREATE INDEX IF NOT EXISTS idx_cancelled_subscription_days_branch ON cancelled_subscription_days(branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_leaves_branch                ON staff_leaves(branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_salary_branch                ON staff_salary(branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_shifts_branch                ON staff_shifts(branch_id);
