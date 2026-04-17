-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Row Level Security Policies
--
-- STATUS: **DISABLED** during development. RLS is intentionally OFF
-- so the team can iterate quickly without hitting policy errors.
-- This file is the ready-to-run bundle to flip on for production.
--
-- To enable everything: run this whole file once. The ENABLE ROW
-- LEVEL SECURITY lines at the top are the actual kill switch; each
-- policy below is additive.
--
-- Role expectations (via JWT custom claim user_role):
--   'customer' — self-scoped reads/writes on own rows
--   'staff'    — branch-scoped, kitchen/delivery operational access
--   'admin'    — unrestricted (bypasses all policies)
-- ═══════════════════════════════════════════════════════════════

-- Helper: read user_role claim safely
CREATE OR REPLACE FUNCTION public.jwt_user_role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'user_role')::TEXT,
    (auth.jwt() -> 'app_metadata' ->> 'user_role'),
    'customer'
  );
$$;

CREATE OR REPLACE FUNCTION public.jwt_branch_id() RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT NULLIF((auth.jwt() ->> 'branch_id'), '')::INTEGER;
$$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT public.jwt_user_role() = '"admin"' OR public.jwt_user_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_staff_or_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT public.jwt_user_role() IN ('"admin"', 'admin', '"staff"', 'staff');
$$;


-- ════════════════════════════════════════════════════════════════
-- PROFILES
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles
  FOR SELECT USING (
    id = auth.uid() OR public.is_staff_or_admin()
  );

DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS profiles_admin_all ON public.profiles;
CREATE POLICY profiles_admin_all ON public.profiles
  FOR ALL USING (public.is_admin());


-- ════════════════════════════════════════════════════════════════
-- ORDERS + ORDER_ITEMS
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_self ON public.orders;
CREATE POLICY orders_self ON public.orders
  FOR SELECT USING (user_id = auth.uid() OR public.is_staff_or_admin());

DROP POLICY IF EXISTS orders_self_insert ON public.orders;
CREATE POLICY orders_self_insert ON public.orders
  FOR INSERT WITH CHECK (user_id = auth.uid() OR public.is_staff_or_admin());

DROP POLICY IF EXISTS orders_staff_update ON public.orders;
CREATE POLICY orders_staff_update ON public.orders
  FOR UPDATE USING (public.is_staff_or_admin());

DROP POLICY IF EXISTS order_items_self ON public.order_items;
CREATE POLICY order_items_self ON public.order_items
  FOR SELECT USING (
    public.is_staff_or_admin() OR
    EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid())
  );


-- ════════════════════════════════════════════════════════════════
-- SUBSCRIPTIONS
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.user_subscriptions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancelled_subscription_days ENABLE ROW LEVEL SECURITY;

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


-- ════════════════════════════════════════════════════════════════
-- CUSTOMER ADDRESSES, WALLET TRANSACTIONS
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.customer_addresses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS addresses_self ON public.customer_addresses;
CREATE POLICY addresses_self ON public.customer_addresses
  FOR ALL USING (user_id = auth.uid() OR public.is_staff_or_admin());

DROP POLICY IF EXISTS wallet_tx_self ON public.wallet_transactions;
CREATE POLICY wallet_tx_self ON public.wallet_transactions
  FOR SELECT USING (user_id = auth.uid() OR public.is_staff_or_admin());

-- Wallet transactions are INSERT-only via service-role RPCs; deny
-- direct client inserts/updates/deletes.
DROP POLICY IF EXISTS wallet_tx_no_writes ON public.wallet_transactions;
CREATE POLICY wallet_tx_no_writes ON public.wallet_transactions
  FOR INSERT WITH CHECK (public.is_admin());


-- ════════════════════════════════════════════════════════════════
-- CATALOG (menu, essentials, cycles, plans, banners)
-- Public readable, admin-only writes.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.menu_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.essentials_catalog   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_cycles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_hubs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_zones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banners              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches             ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'menu_items','essentials_catalog','delivery_cycles','delivery_hubs',
    'delivery_zones','subscription_plans','subscription_plan_items',
    'banners','branches'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read_all ON public.%I',  tbl || '_read',  tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_admin_write ON public.%I', tbl || '_admin', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)',
                   tbl || '_read_all', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin())',
                   tbl || '_admin_write', tbl);
  END LOOP;
END $$;


-- ════════════════════════════════════════════════════════════════
-- STAFF TABLES
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.expense_claims     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attendance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_salary       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_expenses  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_claims_self ON public.expense_claims;
CREATE POLICY expense_claims_self ON public.expense_claims
  FOR ALL USING (staff_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS attendance_self ON public.staff_attendance;
CREATE POLICY attendance_self ON public.staff_attendance
  FOR ALL USING (staff_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS leave_self ON public.staff_leave;
CREATE POLICY leave_self ON public.staff_leave
  FOR ALL USING (staff_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS salary_self ON public.staff_salary;
CREATE POLICY salary_self ON public.staff_salary
  FOR SELECT USING (staff_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS business_expenses_admin ON public.business_expenses;
CREATE POLICY business_expenses_admin ON public.business_expenses
  FOR ALL USING (public.is_admin());


-- ════════════════════════════════════════════════════════════════
-- STORE CONFIG / FEATURE FLAGS (public read, admin write)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.store_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_config_read ON public.store_config;
CREATE POLICY store_config_read ON public.store_config
  FOR SELECT USING (true);
DROP POLICY IF EXISTS store_config_admin ON public.store_config;
CREATE POLICY store_config_admin ON public.store_config
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS feature_flags_read ON public.feature_flags;
CREATE POLICY feature_flags_read ON public.feature_flags
  FOR SELECT USING (true);
DROP POLICY IF EXISTS feature_flags_admin ON public.feature_flags;
CREATE POLICY feature_flags_admin ON public.feature_flags
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());


-- ════════════════════════════════════════════════════════════════
-- REFERRALS
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.referrals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_settings  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referrals_self ON public.referrals;
CREATE POLICY referrals_self ON public.referrals
  FOR SELECT USING (referrer_id = auth.uid() OR referee_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS referral_settings_read ON public.referral_settings;
CREATE POLICY referral_settings_read ON public.referral_settings
  FOR SELECT USING (true);
DROP POLICY IF EXISTS referral_settings_admin ON public.referral_settings;
CREATE POLICY referral_settings_admin ON public.referral_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());


-- ════════════════════════════════════════════════════════════════
-- PUSH TOKENS + FEEDBACK + NOTES
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.push_notification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_feedback             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notes              ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_tokens_self ON public.push_notification_tokens;
CREATE POLICY push_tokens_self ON public.push_notification_tokens
  FOR ALL USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS feedback_self ON public.app_feedback;
CREATE POLICY feedback_self ON public.app_feedback
  FOR SELECT USING (user_id = auth.uid() OR public.is_staff_or_admin());
DROP POLICY IF EXISTS feedback_self_insert ON public.app_feedback;
CREATE POLICY feedback_self_insert ON public.app_feedback
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS admin_notes_read ON public.admin_notes;
CREATE POLICY admin_notes_read ON public.admin_notes
  FOR SELECT USING (public.is_staff_or_admin());
DROP POLICY IF EXISTS admin_notes_admin ON public.admin_notes;
CREATE POLICY admin_notes_admin ON public.admin_notes
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());


-- ════════════════════════════════════════════════════════════════
-- IDEMPOTENCY + WEBHOOK + LOG TABLES (service-role only via RPCs)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.idempotency_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_wallet_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_push_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manifest_run_log      ENABLE ROW LEVEL SECURITY;

-- No policies ⇒ all access is denied to authenticated/anon. Service-role
-- bypasses RLS. Admins can view via their own policy.
DROP POLICY IF EXISTS idempotency_admin ON public.idempotency_keys;
CREATE POLICY idempotency_admin ON public.idempotency_keys
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS pending_topups_admin ON public.pending_wallet_topups;
CREATE POLICY pending_topups_admin ON public.pending_wallet_topups
  FOR SELECT USING (public.is_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS kitchen_push_log_admin ON public.kitchen_push_log;
CREATE POLICY kitchen_push_log_admin ON public.kitchen_push_log
  FOR SELECT USING (public.is_staff_or_admin());

DROP POLICY IF EXISTS manifest_log_admin ON public.manifest_run_log;
CREATE POLICY manifest_log_admin ON public.manifest_run_log
  FOR SELECT USING (public.is_admin());
