-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Custom subscription plans, Phase 1: the foundations
--
-- Adds the data a customer-built plan needs, and NOTHING that changes
-- behaviour. Nothing reads these columns yet; the builder and the manifest
-- surgery come in Phases 2 and 3. Applying this file on its own is a no-op
-- for every existing screen and every running subscription.
--
-- WHAT A CUSTOM PLAN WILL BE. A row in `subscription_plans`, flagged
-- `is_custom`, owned by `created_by`. That is deliberate: `plan_items` is
-- read by two dozen places including generate_daily_manifest — the cron that
-- creates tomorrow's deliveries — plus the conflict check, pause/skip,
-- expiry pushes, admin cancel-with-refund and the reports. A separate table
-- would mean teaching all of them about two sources, including the daily
-- delivery path. A flag means they all keep working untouched, at the cost
-- of three `WHERE is_custom = false` clauses on the lists that browse plans.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- After deploying: npm run supabase:gen-types
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Which catalogue items a CUSTOMER may put in a plan ──────
--
-- Not everything on the menu belongs in a subscription. A vendor's goods and
-- anything that is not house-brand need a decision per item, so this is an
-- explicit admin grant rather than something inferred.
--
-- DEFAULT FALSE, deliberately. The safe failure is an empty builder that an
-- admin has to populate, not a customer locking in thirty days of an item
-- nobody meant to offer that way.
--
-- Note this governs the CUSTOMER's builder only. An admin composing a listed
-- plan keeps using building blocks (is_customer_visible = false), which no
-- customer can pick and which this flag is not consulted for.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS plan_eligible BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.essentials_catalog
  ADD COLUMN IF NOT EXISTS plan_eligible BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.menu_items.plan_eligible IS
  'Admin grant: may a CUSTOMER add this to a custom subscription plan? Only ever meaningful where is_customer_visible = true — a building block is not offerable.';
COMMENT ON COLUMN public.essentials_catalog.plan_eligible IS
  'Admin grant: may a CUSTOMER add this to a custom subscription plan?';

-- Small partial indexes: the builder always asks "eligible items for this
-- cycle", never "all eligible items".
CREATE INDEX IF NOT EXISTS menu_items_plan_eligible_idx
  ON public.menu_items (cycle_id) WHERE plan_eligible;
CREATE INDEX IF NOT EXISTS essentials_plan_eligible_idx
  ON public.essentials_catalog (cycle_id) WHERE plan_eligible;


-- ── 2. Marking a plan as customer-built ────────────────────────
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.subscription_plans.is_custom IS
  'True for a plan a customer built for themselves. Excluded from every browse list, the admin plan manager and plan-wise reports; reachable only by its owner.';
COMMENT ON COLUMN public.subscription_plans.created_by IS
  'The customer who built a custom plan. NULL for admin-listed plans.';

-- Every list that browses plans filters on is_custom, and the owner's own
-- lookup filters on created_by.
CREATE INDEX IF NOT EXISTS subscription_plans_listed_idx
  ON public.subscription_plans (cycle_id) WHERE NOT is_custom;
CREATE INDEX IF NOT EXISTS subscription_plans_owner_idx
  ON public.subscription_plans (created_by) WHERE is_custom;


-- ── 3. The discount schedule ───────────────────────────────────
--
-- A table rather than columns on store_config: the bounds move, and a fourth
-- slab should not need a migration. Three rows to start.
--
-- GOVERNS CUSTOM PLANS ONLY. An admin composing a listed plan sees the slab
-- price as a SUGGESTION and may override it — a curated plan is a commercial
-- offer, and pricing one below formula as a loss-leader is a lever worth
-- keeping. Breakfast 30 stays at its current ₹1,250 until somebody decides
-- otherwise; nothing here reprices an existing plan.
CREATE TABLE IF NOT EXISTS public.subscription_discount_slabs (
  id         BIGSERIAL PRIMARY KEY,
  min_days   INTEGER NOT NULL,
  max_days   INTEGER NOT NULL,
  percent    NUMERIC(5,2) NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT slab_range_sane   CHECK (min_days >= 1 AND max_days >= min_days),
  CONSTRAINT slab_percent_sane CHECK (percent >= 0 AND percent < 100)
);

COMMENT ON TABLE public.subscription_discount_slabs IS
  'Length-based discount for CUSTOM plans. Longer commitment, bigger discount. Admin-editable at Manage → Subscriptions.';

-- Seeded once. ON CONFLICT DO NOTHING is not enough on a BIGSERIAL table, so
-- the guard is "is it empty" — a re-paste must not duplicate the schedule or
-- resurrect slabs an admin has deleted.
INSERT INTO public.subscription_discount_slabs (min_days, max_days, percent)
SELECT * FROM (VALUES
  (10, 19, 5.00),
  (20, 34, 8.00),
  (35, 45, 12.00)
) AS seed(min_days, max_days, percent)
WHERE NOT EXISTS (SELECT 1 FROM public.subscription_discount_slabs);


-- ── 4. Resolving a duration to its discount ────────────────────
--
-- One place, so the builder's preview, the create RPC and anything later all
-- agree. Returns 0 for a duration no active slab covers rather than raising:
-- a gap in the schedule must mean "no discount", never a failed purchase.
--
-- Highest percent wins if slabs overlap. An admin can save overlapping
-- ranges — the CHECK only guards each row on its own — and the customer
-- should not be the one who loses to a configuration mistake.
CREATE OR REPLACE FUNCTION public.plan_discount_percent(p_days INTEGER)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(percent), 0)
  FROM subscription_discount_slabs
  WHERE is_active
    AND p_days >= min_days
    AND p_days <= max_days;
$$;


-- ── 5. Access ──────────────────────────────────────────────────
-- The schedule is read by the customer's builder to show what a length is
-- worth, so it is readable by any signed-in user. Writing it is an admin act
-- and goes through the same is_admin() gate as the rest of the config.
ALTER TABLE public.subscription_discount_slabs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS slabs_read_all ON public.subscription_discount_slabs;
CREATE POLICY slabs_read_all ON public.subscription_discount_slabs
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS slabs_admin_write ON public.subscription_discount_slabs;
CREATE POLICY slabs_admin_write ON public.subscription_discount_slabs
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- GRANT first, then policy — a policy alone grants nothing.
GRANT SELECT ON public.subscription_discount_slabs TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.subscription_discount_slabs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.subscription_discount_slabs_id_seq TO authenticated;

REVOKE ALL   ON FUNCTION public.plan_discount_percent(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_discount_percent(INTEGER) TO authenticated;

-- plan_eligible is admin-written. The existing column-level grants on these
-- tables are per-column, so the new one has to be named explicitly or an
-- admin's toggle silently writes nothing (a refused RLS write is not an
-- error — zero rows, success code).
GRANT UPDATE (plan_eligible) ON public.menu_items TO authenticated;
GRANT UPDATE (plan_eligible) ON public.essentials_catalog TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Verify ─────────────────────────────────────────────────────
--   SELECT * FROM subscription_discount_slabs ORDER BY min_days;
--   SELECT plan_discount_percent(15), plan_discount_percent(30),
--          plan_discount_percent(45), plan_discount_percent(7);
--     -- expect 5, 8, 12, 0
--
-- ── Rollback ───────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.plan_discount_percent(INTEGER);
--   DROP TABLE IF EXISTS public.subscription_discount_slabs;
--   ALTER TABLE public.subscription_plans  DROP COLUMN IF EXISTS is_custom,
--                                          DROP COLUMN IF EXISTS created_by;
--   ALTER TABLE public.menu_items          DROP COLUMN IF EXISTS plan_eligible;
--   ALTER TABLE public.essentials_catalog  DROP COLUMN IF EXISTS plan_eligible;
