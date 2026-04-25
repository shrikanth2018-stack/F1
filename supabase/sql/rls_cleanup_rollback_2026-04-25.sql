-- ═══════════════════════════════════════════════════════════════════
-- 1stOne F1 — RLS Cleanup ROLLBACK (2026-04-25)
--
-- Run ONLY if rls_cleanup_2026-04-25.sql causes a regression in testing.
-- Restores every policy to its pre-cleanup state exactly.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ── REVERT PART 1: Remove WITH CHECK additions ──────────────────

DROP POLICY IF EXISTS addresses_self ON public.customer_addresses;
CREATE POLICY addresses_self ON public.customer_addresses
  FOR ALL USING (user_id = auth.uid() OR public.is_staff_or_admin());

DROP POLICY IF EXISTS expense_claims_self ON public.expense_claims;
CREATE POLICY expense_claims_self ON public.expense_claims
  FOR ALL USING (staff_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS push_tokens_self ON public.push_notification_tokens;
CREATE POLICY push_tokens_self ON public.push_notification_tokens
  FOR ALL USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS attendance_self ON public.staff_attendance;
CREATE POLICY attendance_self ON public.staff_attendance
  FOR ALL USING (staff_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS leave_self ON public.staff_leaves;
CREATE POLICY leave_self ON public.staff_leaves
  FOR ALL USING (staff_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS salary_admin ON public.staff_salary;
CREATE POLICY salary_admin ON public.staff_salary
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS user_subs_self ON public.user_subscriptions;
CREATE POLICY user_subs_self ON public.user_subscriptions
  FOR ALL USING (user_id = auth.uid() OR public.is_staff_or_admin());

DROP POLICY IF EXISTS cancelled_days_self ON public.cancelled_subscription_days;
CREATE POLICY cancelled_days_self ON public.cancelled_subscription_days
  FOR ALL USING (
    public.is_staff_or_admin() OR
    EXISTS (
      SELECT 1 FROM public.user_subscriptions us
      WHERE us.id = subscription_id AND us.user_id = auth.uid()
    )
  );

-- ── REVERT PART 2: Recreate dropped duplicate policies ──────────

CREATE POLICY profiles_service_read ON public.profiles
  FOR SELECT TO supabase_auth_admin USING (true);

CREATE POLICY auth_admin_read_profiles ON public.profiles
  FOR SELECT TO supabase_auth_admin USING (true);

CREATE POLICY "admins can manage hubs" ON public.delivery_hubs
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

-- ── REVERT PART 3: Restore pre-polish state ─────────────────────

DROP POLICY IF EXISTS push_logs_admin_read ON public.push_logs;
CREATE POLICY "Admins can view push logs" ON public.push_logs
  FOR SELECT TO authenticated
  USING (
    (SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS order_item_ratings_read ON public.order_item_ratings;
CREATE POLICY "own rows select" ON public.order_item_ratings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMIT;
