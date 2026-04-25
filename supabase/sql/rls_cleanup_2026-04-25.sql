-- ═══════════════════════════════════════════════════════════════════
-- 1stOne F1 — RLS Cleanup (2026-04-25)
--
-- Combines THREE concerns in one atomic transaction:
--   1. CRITICAL: add WITH CHECK to 8 tables (closes row-hijack vulnerability)
--   2. CLEANUP: drop redundant duplicate policies (single source of truth)
--   3. POLISH:  swap subquery for is_admin() helper, widen ratings read
--
-- Run in Supabase Dashboard → SQL Editor → New query → Run.
-- Atomic: if any single statement fails, NOTHING applies (BEGIN/COMMIT).
--
-- Rollback file (only needed if testing reveals an issue):
--   supabase/sql/rls_cleanup_rollback_2026-04-25.sql
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────
-- PART 1 — CRITICAL: Add WITH CHECK to row-hijack-prone tables
-- ──────────────────────────────────────────────────────────────────
-- Without WITH CHECK, an authenticated user can INSERT a row with any
-- user_id, or UPDATE their own row to change user_id to someone else's.
-- These re-creates mirror USING into WITH CHECK so the resulting row
-- shape is enforced.

-- 1.1 customer_addresses
DROP POLICY IF EXISTS addresses_self ON public.customer_addresses;
CREATE POLICY addresses_self ON public.customer_addresses
  FOR ALL
  USING      (user_id = auth.uid() OR public.is_staff_or_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_staff_or_admin());

-- 1.2 expense_claims
DROP POLICY IF EXISTS expense_claims_self ON public.expense_claims;
CREATE POLICY expense_claims_self ON public.expense_claims
  FOR ALL
  USING      (staff_id = auth.uid() OR public.is_admin())
  WITH CHECK (staff_id = auth.uid() OR public.is_admin());

-- 1.3 push_notification_tokens
DROP POLICY IF EXISTS push_tokens_self ON public.push_notification_tokens;
CREATE POLICY push_tokens_self ON public.push_notification_tokens
  FOR ALL
  USING      (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- 1.4 staff_attendance
DROP POLICY IF EXISTS attendance_self ON public.staff_attendance;
CREATE POLICY attendance_self ON public.staff_attendance
  FOR ALL
  USING      (staff_id = auth.uid() OR public.is_admin())
  WITH CHECK (staff_id = auth.uid() OR public.is_admin());

-- 1.5 staff_leaves (live name, not staff_leave from old bundle)
DROP POLICY IF EXISTS leave_self ON public.staff_leaves;
CREATE POLICY leave_self ON public.staff_leaves
  FOR ALL
  USING      (staff_id = auth.uid() OR public.is_admin())
  WITH CHECK (staff_id = auth.uid() OR public.is_admin());

-- 1.6 staff_salary — admin policy needs WITH CHECK
DROP POLICY IF EXISTS salary_admin ON public.staff_salary;
CREATE POLICY salary_admin ON public.staff_salary
  FOR ALL
  USING      (public.is_admin())
  WITH CHECK (public.is_admin());

-- 1.7 user_subscriptions
DROP POLICY IF EXISTS user_subs_self ON public.user_subscriptions;
CREATE POLICY user_subs_self ON public.user_subscriptions
  FOR ALL
  USING      (user_id = auth.uid() OR public.is_staff_or_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_staff_or_admin());

-- 1.8 cancelled_subscription_days
DROP POLICY IF EXISTS cancelled_days_self ON public.cancelled_subscription_days;
CREATE POLICY cancelled_days_self ON public.cancelled_subscription_days
  FOR ALL
  USING (
    public.is_staff_or_admin() OR
    EXISTS (
      SELECT 1 FROM public.user_subscriptions us
      WHERE us.id = subscription_id AND us.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_staff_or_admin() OR
    EXISTS (
      SELECT 1 FROM public.user_subscriptions us
      WHERE us.id = subscription_id AND us.user_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- PART 2 — CLEANUP: Remove duplicate / redundant policies
-- ──────────────────────────────────────────────────────────────────

-- 2.1 profiles — keep ONE supabase_auth_admin bypass, drop 2 duplicates
-- KEEP: profiles_auth_hook_bypass (cleanest name; documents intent)
DROP POLICY IF EXISTS profiles_service_read ON public.profiles;
DROP POLICY IF EXISTS auth_admin_read_profiles ON public.profiles;

-- 2.2 delivery_hubs — keep one admin policy
-- KEEP: delivery_hubs_admin_write (uses is_admin() helper, consistent)
DROP POLICY IF EXISTS "admins can manage hubs" ON public.delivery_hubs;

-- ──────────────────────────────────────────────────────────────────
-- PART 3 — POLISH
-- ──────────────────────────────────────────────────────────────────

-- 3.1 push_logs — replace inline subquery with is_admin() helper
-- (subquery runs once per row; helper is STABLE so optimised)
DROP POLICY IF EXISTS "Admins can view push logs" ON public.push_logs;
CREATE POLICY push_logs_admin_read ON public.push_logs
  FOR SELECT
  USING (public.is_admin());

-- 3.2 order_item_ratings — let staff/admin read all (was: own rows only)
-- Needed for admin reports / kitchen feedback dashboards
DROP POLICY IF EXISTS "own rows select" ON public.order_item_ratings;
CREATE POLICY order_item_ratings_read ON public.order_item_ratings
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_staff_or_admin());

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- POST-RUN VERIFICATION
-- After running, paste this query in a separate tab and verify:
--   • profiles policy_count drops from 6 → 4 (dropped 2 duplicates)
--   • delivery_hubs drops from 3 → 2 (dropped 1 duplicate)
--   • All 8 critical-fix tables now have non-null with_check on their policy
-- ═══════════════════════════════════════════════════════════════════

-- SELECT tablename, policyname, cmd,
--        (qual IS NOT NULL) AS has_using,
--        (with_check IS NOT NULL) AS has_check
-- FROM pg_policies WHERE schemaname='public'
-- ORDER BY tablename, cmd;
