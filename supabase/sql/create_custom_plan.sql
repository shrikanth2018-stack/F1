-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Custom plans, Phase 3: the customer builds one
--
-- The phone sends a SPEC — cycle, items, quantities, duration. Never a
-- price. This function re-reads every price from the catalogue, applies the
-- admin's length slab and writes the plan. Same rule as the order path: the
-- server decides money, and the only number the client contributes is a
-- quantity.
--
-- Creating the plan HERE rather than at checkout is deliberate. The plan row
-- exists before the cart does, so the cart carries an ordinary plan_id and
-- quote-order / place-order need no changes at all — and place-order's
-- payload is not backward-compatible, so avoiding it means the app and the
-- edge functions do not have to ship together. The cost is an orphan row if
-- somebody builds a plan and never buys it: invisible (every list filters
-- is_custom), owned by nobody else, and sweepable.
--
-- Deploy: paste into the Supabase SQL editor, AFTER custom_plan_foundations.sql.
-- Verify:  supabase db query --linked --file supabase/tests/custom_plan_check.sql
-- ═══════════════════════════════════════════════════════════════

-- ── A personal plan is not public ──────────────────────────────
-- subscription_plans_read_all was `USING (true)`, which is right for the
-- listed range and wrong the moment a row belongs to one customer. Every
-- browse list also filters is_custom, but a list is a convention and this is
-- the gate: forget the filter on some future screen and RLS still refuses.
DROP POLICY IF EXISTS subscription_plans_read_all ON public.subscription_plans;
CREATE POLICY subscription_plans_read_all ON public.subscription_plans
  FOR SELECT TO authenticated
  USING (
    NOT is_custom              -- the listed range, visible to everyone
    OR created_by = auth.uid() -- your own plan
    OR public.is_admin()       -- support and reporting
  );


-- The 3-argument version is dropped rather than left beside this one:
-- PostgREST resolves by named arguments, and two overloads differing only by
-- an optional parameter is exactly the ambiguity it cannot settle.
DROP FUNCTION IF EXISTS public.create_custom_plan(INTEGER, JSONB, INTEGER);

CREATE OR REPLACE FUNCTION public.create_custom_plan(
  p_cycle_id      INTEGER,
  p_items         JSONB,     -- [{item_id, item_type, quantity}]
  p_duration_days INTEGER,
  p_plan_name     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  MIN_DAYS  CONSTANT INTEGER := 10;
  MAX_DAYS  CONSTANT INTEGER := 45;
  /**
   * Raised 3 → 5 on 12 Aug 2026 with the builder rebuild.
   *
   * EDITED IN PLACE, NOT SUPERSEDED BY A NEW FILE. Three functions in this
   * folder are now defined by two files each — push_kitchen_summary,
   * generate_daily_manifest, get_kitchen_aggregate — and every one of them
   * carries a warning about which must be applied last. The runbook's own rule
   * for an RPC change is to edit its file and re-run it (CREATE OR REPLACE),
   * and that is what keeps this one having a single definition.
   *
   * The app caps the picker at the same number. It is not the gate — this is —
   * but a customer should meet the limit as a disabled `+`, not as a refusal
   * after they have filled the whole form in.
   */
  MAX_ITEMS CONSTANT INTEGER := 5;
  MAX_QTY   CONSTANT INTEGER := 10;

  v_user      UUID := auth.uid();
  v_cycle     RECORD;
  v_line      JSONB;
  v_lines     JSONB := '[]'::jsonb;
  v_food_seen INTEGER := 0;
  v_daily     NUMERIC := 0;
  v_name      TEXT;
  v_price     NUMERIC;
  v_pct       NUMERIC;
  v_full      NUMERIC;
  v_branch    BIGINT;
  v_plan_id   INTEGER;
  v_item_id   INTEGER;
  v_type      TEXT;
  v_qty       INTEGER;
  v_row       RECORD;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to build a plan.';
  END IF;

  -- ── Shape ────────────────────────────────────────────────────
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one item to your plan.';
  END IF;
  IF jsonb_array_length(p_items) > MAX_ITEMS THEN
    RAISE EXCEPTION 'A plan can hold up to % items.', MAX_ITEMS;
  END IF;
  IF p_duration_days IS NULL OR p_duration_days < MIN_DAYS OR p_duration_days > MAX_DAYS THEN
    RAISE EXCEPTION 'Choose a length between % and % days.', MIN_DAYS, MAX_DAYS;
  END IF;

  SELECT id, cycle_name, branch_id INTO v_cycle
  FROM delivery_cycles WHERE id = p_cycle_id AND is_active;
  IF v_cycle.id IS NULL THEN
    RAISE EXCEPTION 'That delivery time is not available.';
  END IF;

  -- ── ONE ACTIVE CUSTOM PLAN PER CYCLE ─────────────────────────
  -- Checked here so the builder can say so before any money is discussed.
  -- The purchase path re-checks it: this row can sit unbought for days, and
  -- a second plan could be started in the meantime.
  IF EXISTS (
    SELECT 1
    FROM user_subscriptions us
    JOIN subscription_plans sp ON sp.id = us.plan_id
    WHERE us.user_id = v_user
      AND us.is_active
      AND sp.is_custom
      AND sp.cycle_id = p_cycle_id
  ) THEN
    RAISE EXCEPTION 'You already have a % plan running. Finish or cancel it before building another.',
      v_cycle.cycle_name;
  END IF;

  -- ── Every line, priced from the catalogue it belongs to ──────
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := (v_line->>'item_id')::INTEGER;
    v_type    := lower(COALESCE(v_line->>'item_type', 'food'));
    v_qty     := COALESCE((v_line->>'quantity')::INTEGER, 1);

    IF v_type NOT IN ('food', 'essential') THEN
      RAISE EXCEPTION 'Unknown item type "%".', v_type;
    END IF;
    IF v_qty < 1 OR v_qty > MAX_QTY THEN
      RAISE EXCEPTION 'Quantity must be between 1 and %.', MAX_QTY;
    END IF;

    IF v_type = 'food' THEN
      -- is_customer_visible as well as plan_eligible: a building block is
      -- priced for back-office use and often at 0, and no customer may put
      -- one in a plan even if somebody flags it eligible by mistake.
      SELECT mi.id, mi.name, mi.price, mi.branch_id INTO v_row
      FROM menu_items mi
      WHERE mi.id = v_item_id AND mi.is_active AND mi.is_customer_visible
        AND mi.plan_eligible AND mi.cycle_id = p_cycle_id;
      v_food_seen := v_food_seen + 1;
    ELSE
      SELECT ec.id, ec.name, ec.price, ec.branch_id INTO v_row
      FROM essentials_catalog ec
      WHERE ec.id = v_item_id AND ec.is_active
        AND ec.plan_eligible AND ec.cycle_id = p_cycle_id;
    END IF;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'One of those items is not available for plans in %.', v_cycle.cycle_name;
    END IF;

    IF v_branch IS NULL THEN v_branch := v_row.branch_id; END IF;
    v_daily := v_daily + (v_row.price * v_qty);

    -- item_type is written into the line, which is what lets the manifest
    -- split a mixed plan into pure rows. item_name too, so a later rename
    -- cannot rewrite what a customer already bought.
    v_lines := v_lines || jsonb_build_object(
      'item_id',   v_row.id,
      'item_type', v_type,
      'item_name', v_row.name,
      'quantity',  v_qty
    );
  END LOOP;

  -- ── At least one food item ───────────────────────────────────
  IF v_food_seen = 0 THEN
    RAISE EXCEPTION 'A plan needs at least one meal. Add a dish, then any essentials alongside it.';
  END IF;
  IF v_daily <= 0 THEN
    RAISE EXCEPTION 'Those items have no price yet. Please pick something else.';
  END IF;

  -- ── Money ────────────────────────────────────────────────────
  v_full  := ROUND(v_daily * p_duration_days, 2);
  v_pct   := plan_discount_percent(p_duration_days);
  v_price := ROUND(v_full * (1 - v_pct / 100.0), 2);

  -- THE CUSTOMER NAMES IT, because they are the only person who will ever see
  -- it — a custom plan never joins the listed range. Blank falls back to a
  -- description rather than an empty heading, and the length cap is here
  -- rather than only on the phone: this function is the boundary, and a name
  -- reaches order slips and push copy.
  v_name := NULLIF(btrim(COALESCE(p_plan_name, '')), '');
  IF v_name IS NULL THEN
    v_name := format('My %s · %s days', v_cycle.cycle_name, p_duration_days);
  ELSIF length(v_name) > 40 THEN
    v_name := left(v_name, 40);
  END IF;

  INSERT INTO subscription_plans (
    plan_name, duration_days, price, savings_amount, plan_type, cycle_id,
    is_active, branch_id, plan_items, is_custom, created_by
  )
  VALUES (
    v_name, p_duration_days, v_price, GREATEST(v_full - v_price, 0),
    -- 'food', always: a plan must hold at least one meal, and plan_type is
    -- no longer what types the LINES — each line carries its own now.
    'food',
    p_cycle_id, TRUE, COALESCE(v_branch, v_cycle.branch_id),
    v_lines::text, TRUE, v_user
  )
  RETURNING id INTO v_plan_id;

  RETURN jsonb_build_object(
    'plan_id',          v_plan_id,
    'plan_name',        v_name,
    'cycle_id',         p_cycle_id,
    'cycle_name',       v_cycle.cycle_name,
    'duration_days',    p_duration_days,
    'daily_total',      ROUND(v_daily, 2),
    'full_price',       v_full,
    'discount_percent', v_pct,
    'price',            v_price,
    'savings',          GREATEST(v_full - v_price, 0)
  );
END;
$$;

REVOKE ALL   ON FUNCTION public.create_custom_plan(INTEGER, JSONB, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_custom_plan(INTEGER, JSONB, INTEGER, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
