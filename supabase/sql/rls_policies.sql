-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Row Level Security Policies
--
-- STATUS: live in dev + prod. RLS is enabled on every table below.
-- Re-running this file is safe (idempotent — DROP + CREATE pairs).
--
-- Role expectations (via JWT custom claims user_role + branch_id):
--   'customer'    — self-scoped reads/writes on own rows
--   'staff'       — branch-scoped operational access
--   branch admin  — admin role + JWT branch_id set; sees one branch
--   super-admin   — admin role + JWT branch_id IS NULL; sees all branches
--
-- Branch scoping (MF-03 Commit 4): every admin/staff path is filtered
-- through public.has_branch_access(row_branch_id), which returns true
-- for super-admin OR when the row's branch_id matches the caller's JWT.
-- Tables without their own branch_id column join through a parent that
-- carries it (orders / subscription_plans / profiles).
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

-- MF-03 Commit 1: distinguishes super-admin (no branch claim → sees all
-- branches) from branch-scoped admin.
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT public.is_admin() AND public.jwt_branch_id() IS NULL;
$$;

-- MF-03 Commit 4 + BF-29 (2026-05-06): per-row branch gate.
--
-- Returns TRUE when:
--   1. Caller is super-admin (no branch claim → sees all branches), OR
--   2. The launch-gate flag `feature_flags.branch_management_active` is
--      OFF — pre-launch single-branch mode. The calling policy's own
--      role gate (is_admin / is_staff_or_admin) stays in force; branch
--      is treated as unscoped. This avoids stranded-NULL branch_id rows
--      / stale JWTs blocking every staff write while the data backfill
--      and JWT refresh are still rolling out, OR
--   3. The row's branch_id matches the caller's JWT branch_id claim
--      (the strict multi-branch enforcement, active once the flag is
--      flipped post-V-06).
--
-- COALESCE(..., FALSE) defends against the row being absent in a fresh
-- DB (treat as off → permissive pre-launch behavior).
CREATE OR REPLACE FUNCTION public.has_branch_access(row_branch_id INTEGER) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT
    public.is_super_admin()
    OR NOT COALESCE(
         (SELECT flag_value FROM public.feature_flags
            WHERE flag_key = 'branch_management_active'),
         FALSE)
    OR row_branch_id = public.jwt_branch_id();
$$;


-- ════════════════════════════════════════════════════════════════
-- PROFILES
--
-- Customers may only modify their own full_name + phone_number on their
-- own row. All privileged column changes (role, branch_id,
-- assigned_hub_id, employee_id, designation, monthly_salary, benefits,
-- shift_timing, joining_date, loyalty_points, wallet_balance,
-- referral_code, referred_by) must flow through SECURITY DEFINER
-- functions (elevate_employee, assign_hub_operator, wallet/loyalty
-- atomic RPCs) or service-role edge functions (apply-referral) — these
-- bypass the column grants below.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Default role to 'customer' so a self-INSERT can never come up rolless.
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'customer';

-- Column-level grants — narrow what authenticated users can write.
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
GRANT  INSERT (id, full_name, phone_number) ON public.profiles TO authenticated;
GRANT  UPDATE (full_name, phone_number)     ON public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR (public.is_staff_or_admin() AND public.has_branch_access(branch_id))
  );

-- Allow users to insert their own profile row. In normal flow the
-- on_auth_user_created trigger on auth.users (calling handle_new_user)
-- creates the stub profile row immediately after OTP signup, so the
-- ON CONFLICT path of complete_onboarding_atomic's UPSERT is the usual
-- path; this policy permits the INSERT branch as a defensive fallback.
DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles
  FOR INSERT WITH CHECK (
    id = auth.uid()
    OR (public.is_admin() AND public.has_branch_access(branch_id))
  );

DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE
  USING      (id = auth.uid() OR (public.is_admin() AND public.has_branch_access(branch_id)))
  WITH CHECK (id = auth.uid() OR (public.is_admin() AND public.has_branch_access(branch_id)));

DROP POLICY IF EXISTS profiles_admin_all ON public.profiles;
CREATE POLICY profiles_admin_all ON public.profiles
  FOR ALL USING (public.is_admin() AND public.has_branch_access(branch_id))
          WITH CHECK (public.is_admin() AND public.has_branch_access(branch_id));


-- ════════════════════════════════════════════════════════════════
-- ORDERS + ORDER_ITEMS
--
-- Customer self by user_id (branch_id check intentionally omitted on
-- the customer path so a freshly-onboarded JWT-lag customer can still
-- place an order — branch is derived server-side by place-order from
-- the customer's address.) Staff/admin scoped by branch_id.
-- order_items joins through orders.branch_id since it has no own column.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_self ON public.orders;
CREATE POLICY orders_self ON public.orders
  FOR SELECT USING (
    user_id = auth.uid()
    OR (public.is_staff_or_admin() AND public.has_branch_access(branch_id))
  );

DROP POLICY IF EXISTS orders_self_insert ON public.orders;
CREATE POLICY orders_self_insert ON public.orders
  FOR INSERT WITH CHECK (
    (user_id = auth.uid() AND status = 'Pending')
    OR (public.is_staff_or_admin() AND public.has_branch_access(branch_id))
  );

-- BF-29 (2026-05-06): dropped the duplicate status enum from WITH CHECK.
-- Value validation is the table-level CHECK constraint's job (schema.sql:270-274
-- already covers every valid status incl. 'Received at Hub'). The previous RLS
-- enum had drifted (missing 'Received at Hub') and silently rejected the
-- driver's Dispatched → Received at Hub handoff. RLS keeps role + branch gating;
-- transition gating stays at the application layer (deliveryStatus.ts).
DROP POLICY IF EXISTS orders_staff_update ON public.orders;
CREATE POLICY orders_staff_update ON public.orders
  FOR UPDATE
  USING      (public.is_staff_or_admin() AND public.has_branch_access(branch_id))
  WITH CHECK (public.is_staff_or_admin() AND public.has_branch_access(branch_id));

DROP POLICY IF EXISTS order_items_self ON public.order_items;
CREATE POLICY order_items_self ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND (
          o.user_id = auth.uid()
          OR (public.is_staff_or_admin() AND public.has_branch_access(o.branch_id))
        )
    )
  );


-- ════════════════════════════════════════════════════════════════
-- SUBSCRIPTIONS
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.user_subscriptions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancelled_subscription_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_subs_self ON public.user_subscriptions;
CREATE POLICY user_subs_self ON public.user_subscriptions
  FOR ALL USING (
    user_id = auth.uid()
    OR (public.is_staff_or_admin() AND public.has_branch_access(branch_id))
  );

DROP POLICY IF EXISTS cancelled_days_self ON public.cancelled_subscription_days;
CREATE POLICY cancelled_days_self ON public.cancelled_subscription_days
  FOR ALL USING (
    (public.is_staff_or_admin() AND public.has_branch_access(branch_id))
    OR EXISTS (
      SELECT 1 FROM public.user_subscriptions us
      WHERE us.id = subscription_id AND us.user_id = auth.uid()
    )
  );


-- ════════════════════════════════════════════════════════════════
-- CUSTOMER ADDRESSES, WALLET TRANSACTIONS
--
-- Addresses scoped by branch_id (own column).
-- Wallet transactions have no own branch_id; admin/staff path joins
-- via profiles.branch_id of the wallet owner.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.customer_addresses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS addresses_self ON public.customer_addresses;
CREATE POLICY addresses_self ON public.customer_addresses
  FOR ALL USING (
    user_id = auth.uid()
    OR (public.is_staff_or_admin() AND public.has_branch_access(branch_id))
  );

DROP POLICY IF EXISTS wallet_tx_self ON public.wallet_transactions;
CREATE POLICY wallet_tx_self ON public.wallet_transactions
  FOR SELECT USING (
    user_id = auth.uid()
    OR (
      public.is_staff_or_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = wallet_transactions.user_id
          AND public.has_branch_access(p.branch_id)
      )
    )
  );

-- Wallet transactions are INSERT-only via service-role RPCs; deny
-- direct client inserts/updates/deletes.
DROP POLICY IF EXISTS wallet_tx_no_writes ON public.wallet_transactions;
CREATE POLICY wallet_tx_no_writes ON public.wallet_transactions
  FOR INSERT WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = wallet_transactions.user_id
        AND public.has_branch_access(p.branch_id)
    )
  );


-- ════════════════════════════════════════════════════════════════
-- CATALOG (menu, essentials, cycles, hubs, zones, plans, plan_items, banners, branches)
--
-- Reads stay public (true) — anon users browse the menu / plans before
-- login; customer/admin client filters via useBranchFilter. Writes are
-- branch-scoped admin (super-admin sees all). subscription_plan_items
-- has no own branch_id and joins via subscription_plans.plan_id.
-- branches table itself has no branch_id — writes restricted to
-- super-admin (only super-admin should mint a branch).
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.menu_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.essentials_catalog      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_cycles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_hubs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_zones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banners                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches                ENABLE ROW LEVEL SECURITY;

-- 7 catalog tables with their own branch_id: public read + branch-scoped admin write.
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'menu_items','essentials_catalog','delivery_cycles','delivery_hubs',
    'delivery_zones','subscription_plans','banners'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read_all   ON public.%I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_admin_write ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_read_all ON public.%I FOR SELECT USING (true)',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY %I_admin_write ON public.%I FOR ALL '
      'USING (public.is_admin() AND public.has_branch_access(branch_id)) '
      'WITH CHECK (public.is_admin() AND public.has_branch_access(branch_id))',
      tbl, tbl
    );
  END LOOP;
END $$;

-- subscription_plan_items: no own branch_id; joins via plan_id.
DROP POLICY IF EXISTS subscription_plan_items_read_all ON public.subscription_plan_items;
CREATE POLICY subscription_plan_items_read_all ON public.subscription_plan_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS subscription_plan_items_admin_write ON public.subscription_plan_items;
CREATE POLICY subscription_plan_items_admin_write ON public.subscription_plan_items
  FOR ALL USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.subscription_plans sp
      WHERE sp.id = plan_id
        AND public.has_branch_access(sp.branch_id)
    )
  )
  WITH CHECK (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.subscription_plans sp
      WHERE sp.id = plan_id
        AND public.has_branch_access(sp.branch_id)
    )
  );

-- branches table itself: public read; only super-admin writes.
DROP POLICY IF EXISTS branches_read_all ON public.branches;
CREATE POLICY branches_read_all ON public.branches
  FOR SELECT USING (true);

DROP POLICY IF EXISTS branches_admin_write ON public.branches;
CREATE POLICY branches_admin_write ON public.branches
  FOR ALL USING (public.is_super_admin())
          WITH CHECK (public.is_super_admin());


-- ════════════════════════════════════════════════════════════════
-- STAFF TABLES
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.expense_claims     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attendance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leaves       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_salary       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_expenses  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_claims_self ON public.expense_claims;
CREATE POLICY expense_claims_self ON public.expense_claims
  FOR ALL USING (
    staff_id = auth.uid()
    OR (public.is_admin() AND public.has_branch_access(branch_id))
  );

DROP POLICY IF EXISTS attendance_self ON public.staff_attendance;
CREATE POLICY attendance_self ON public.staff_attendance
  FOR ALL USING (
    staff_id = auth.uid()
    OR (public.is_admin() AND public.has_branch_access(branch_id))
  );

DROP POLICY IF EXISTS leave_self ON public.staff_leaves;
CREATE POLICY leave_self ON public.staff_leaves
  FOR ALL USING (
    staff_id = auth.uid()
    OR (public.is_admin() AND public.has_branch_access(branch_id))
  );

DROP POLICY IF EXISTS salary_self ON public.staff_salary;
CREATE POLICY salary_self ON public.staff_salary
  FOR SELECT USING (
    staff_id = auth.uid()
    OR (public.is_admin() AND public.has_branch_access(branch_id))
  );

DROP POLICY IF EXISTS business_expenses_admin ON public.business_expenses;
CREATE POLICY business_expenses_admin ON public.business_expenses
  FOR ALL USING (public.is_admin() AND public.has_branch_access(branch_id))
          WITH CHECK (public.is_admin() AND public.has_branch_access(branch_id));


-- ════════════════════════════════════════════════════════════════
-- STORE CONFIG / FEATURE FLAGS / REFERRAL SETTINGS
--
-- Global single-row config — public read, super-admin write only.
-- Branch admins should not flip global flags or feature toggles.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.store_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_config_read ON public.store_config;
CREATE POLICY store_config_read ON public.store_config
  FOR SELECT USING (true);
DROP POLICY IF EXISTS store_config_admin ON public.store_config;
CREATE POLICY store_config_admin ON public.store_config
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS feature_flags_read ON public.feature_flags;
CREATE POLICY feature_flags_read ON public.feature_flags
  FOR SELECT USING (true);
DROP POLICY IF EXISTS feature_flags_admin ON public.feature_flags;
CREATE POLICY feature_flags_admin ON public.feature_flags
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


-- ════════════════════════════════════════════════════════════════
-- REFERRALS
--
-- Referrals are pair-bound (referrer_id, referee_id) and have no
-- branch_id column. Self-clauses handle user reads. Admin clause stays
-- as is_admin() — branch admin oversight of referrals is rare and
-- joining via either profile would be a double-EXISTS query on every
-- read. Referral settings restricted to super-admin (global config).
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
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


-- ════════════════════════════════════════════════════════════════
-- PUSH TOKENS + FEEDBACK + NOTES
--
-- push_tokens and app_feedback have no own branch_id; admin/staff
-- paths join via profiles.branch_id of the row owner.
-- admin_notes carries branch_id directly.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.push_notification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_feedback             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notes              ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_tokens_self ON public.push_notification_tokens;
CREATE POLICY push_tokens_self ON public.push_notification_tokens
  FOR ALL USING (
    user_id = auth.uid()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = push_notification_tokens.user_id
          AND public.has_branch_access(p.branch_id)
      )
    )
  );

DROP POLICY IF EXISTS feedback_self ON public.app_feedback;
CREATE POLICY feedback_self ON public.app_feedback
  FOR SELECT USING (
    user_id = auth.uid()
    OR (
      public.is_staff_or_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = app_feedback.user_id
          AND public.has_branch_access(p.branch_id)
      )
    )
  );
DROP POLICY IF EXISTS feedback_self_insert ON public.app_feedback;
CREATE POLICY feedback_self_insert ON public.app_feedback
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS admin_notes_read ON public.admin_notes;
CREATE POLICY admin_notes_read ON public.admin_notes
  FOR SELECT USING (public.is_staff_or_admin() AND public.has_branch_access(branch_id));
DROP POLICY IF EXISTS admin_notes_admin ON public.admin_notes;
CREATE POLICY admin_notes_admin ON public.admin_notes
  FOR ALL USING (public.is_admin() AND public.has_branch_access(branch_id))
          WITH CHECK (public.is_admin() AND public.has_branch_access(branch_id));


-- ════════════════════════════════════════════════════════════════
-- IDEMPOTENCY + WEBHOOK + LOG TABLES (service-role only via RPCs)
--
-- All four are global ops surfaces — service-role bypasses RLS, super-
-- admin gets read access for observability. Branch admins do not see
-- these (idempotency keys, push log, manifest log are cross-branch by
-- design). pending_wallet_topups keeps the user-self clause.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.idempotency_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_wallet_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_push_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manifest_run_log      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idempotency_admin ON public.idempotency_keys;
CREATE POLICY idempotency_admin ON public.idempotency_keys
  FOR SELECT USING (public.is_super_admin());

DROP POLICY IF EXISTS pending_topups_admin ON public.pending_wallet_topups;
CREATE POLICY pending_topups_admin ON public.pending_wallet_topups
  FOR SELECT USING (
    user_id = auth.uid()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = pending_wallet_topups.user_id
          AND public.has_branch_access(p.branch_id)
      )
    )
  );

DROP POLICY IF EXISTS kitchen_push_log_admin ON public.kitchen_push_log;
CREATE POLICY kitchen_push_log_admin ON public.kitchen_push_log
  FOR SELECT USING (public.is_super_admin());

DROP POLICY IF EXISTS manifest_log_admin ON public.manifest_run_log;
CREATE POLICY manifest_log_admin ON public.manifest_run_log
  FOR SELECT USING (public.is_super_admin());
