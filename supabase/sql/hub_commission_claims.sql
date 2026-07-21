-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Hub Commission Claims
--
-- Hub operators claim their monthly commission from the Hub Dashboard.
-- The claim lands in expense_claims (category 'Hub Commission') and rides
-- the existing admin flow: Pending → Approved → Paid (Expense Manager).
--
-- Server-authoritative money (golden rule): the claim AMOUNT is computed
-- here, never sent by the client —
--   base       = SUM(order_items.price_at_time × quantity)
--                over orders Delivered at the hub in the claim month,
--                item_type IN ('food','essential')  ← counts subscription
--                dispatch deliveries correctly despite their ₹0 order rows
--                (BF-19) and excludes subscription-purchase revenue rows.
--   commission = round(base × delivery_hubs.commission_percent / 100, 2)
--
-- Claim period: one calendar month (IST), claimable only once the month
-- has ended. Double-claims are blocked by a partial unique index on
-- (hub_id, claim_period) — not just an EXISTS check.
--
-- Deploy: paste this entire file into Supabase SQL editor. Idempotent.
-- App coupling: run BEFORE the OTA that adds the Commission tab. Old app
-- builds are unaffected (additive columns + new RPCs only).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Claim metadata columns (additive, nullable) ─────────────
ALTER TABLE public.expense_claims
  ADD COLUMN IF NOT EXISTS hub_id INTEGER REFERENCES public.delivery_hubs(id),
  ADD COLUMN IF NOT EXISTS claim_period DATE;

COMMENT ON COLUMN public.expense_claims.hub_id IS
  'Set only on hub-commission claims — the hub the commission belongs to.';
COMMENT ON COLUMN public.expense_claims.claim_period IS
  'Set only on hub-commission claims — first day of the claimed month (IST).';

-- One commission claim per hub per month, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS ux_expense_claims_hub_period
  ON public.expense_claims (hub_id, claim_period)
  WHERE hub_id IS NOT NULL;

-- ── 2. Shared internal helper: compute a hub's commission ──────
-- Returns (delivered_orders, base_amount, commission) for one hub over
-- [p_start, p_next_start). Not granted to clients — called by the two
-- SECURITY DEFINER entry points below.
CREATE OR REPLACE FUNCTION public._hub_commission_for_period(
  p_hub_id INTEGER,
  p_start DATE,
  p_next_start DATE
)
RETURNS TABLE (delivered_orders BIGINT, base_amount NUMERIC, commission NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(DISTINCT o.id)                                   AS delivered_orders,
    COALESCE(SUM(oi.price_at_time * oi.quantity), 0)       AS base_amount,
    ROUND(
      COALESCE(SUM(oi.price_at_time * oi.quantity), 0)
      * COALESCE((SELECT h.commission_percent FROM public.delivery_hubs h WHERE h.id = p_hub_id), 0)
      / 100.0,
    2)                                                     AS commission
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.hub_id = p_hub_id
    AND o.status = 'Delivered'
    AND o.dispatch_date >= p_start
    AND o.dispatch_date <  p_next_start
    AND oi.item_type IN ('food', 'essential');
$$;

-- ── 3. Summary for the Hub Dashboard (read-only) ───────────────
-- Caller = the hub operator (profiles.assigned_hub_id). Returns last
-- complete month (claimable) + current month (accruing) + claim state.
CREATE OR REPLACE FUNCTION public.get_hub_commission_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hub_id INTEGER;
  v_hub RECORD;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_cur_start DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_last_start DATE;
  v_last RECORD;
  v_cur RECORD;
  v_claim RECORD;
BEGIN
  SELECT assigned_hub_id INTO v_hub_id FROM profiles WHERE id = auth.uid();
  IF v_hub_id IS NULL THEN
    RAISE EXCEPTION 'Not a hub operator';
  END IF;

  SELECT id, hub_name, commission_percent INTO v_hub
  FROM delivery_hubs WHERE id = v_hub_id;

  v_last_start := (v_cur_start - INTERVAL '1 month')::date;

  SELECT * INTO v_last FROM _hub_commission_for_period(v_hub_id, v_last_start, v_cur_start);
  SELECT * INTO v_cur  FROM _hub_commission_for_period(v_hub_id, v_cur_start, (v_cur_start + INTERVAL '1 month')::date);

  SELECT id, status, amount, created_at INTO v_claim
  FROM expense_claims
  WHERE hub_id = v_hub_id AND claim_period = v_last_start;

  RETURN jsonb_build_object(
    'hub_id', v_hub.id,
    'hub_name', v_hub.hub_name,
    'commission_percent', COALESCE(v_hub.commission_percent, 0),
    'last_month', jsonb_build_object(
      'period_start', v_last_start,
      'label', to_char(v_last_start, 'FMMonth YYYY'),
      'delivered_orders', v_last.delivered_orders,
      'base_amount', v_last.base_amount,
      'commission', v_last.commission,
      'claimed', v_claim.id IS NOT NULL,
      'claim_status', v_claim.status,
      'claim_amount', v_claim.amount
    ),
    'current_month', jsonb_build_object(
      'period_start', v_cur_start,
      'label', to_char(v_cur_start, 'FMMonth YYYY'),
      'delivered_orders', v_cur.delivered_orders,
      'base_amount', v_cur.base_amount,
      'commission', v_cur.commission,
      'as_of', v_today
    )
  );
END;
$$;

-- ── 4. Create the claim (atomic, server-priced) ────────────────
CREATE OR REPLACE FUNCTION public.create_hub_commission_claim()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hub_id INTEGER;
  v_hub RECORD;
  v_cur_start DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_period_start DATE;
  v_calc RECORD;
  v_claim_id BIGINT;
BEGIN
  SELECT assigned_hub_id INTO v_hub_id FROM profiles WHERE id = auth.uid();
  IF v_hub_id IS NULL THEN
    RAISE EXCEPTION 'Not a hub operator';
  END IF;

  SELECT id, hub_name, commission_percent, branch_id INTO v_hub
  FROM delivery_hubs WHERE id = v_hub_id;

  IF COALESCE(v_hub.commission_percent, 0) <= 0 THEN
    RAISE EXCEPTION 'No commission percentage is set for your hub. Please contact the admin.';
  END IF;

  -- Only the last COMPLETE month is claimable.
  v_period_start := (v_cur_start - INTERVAL '1 month')::date;

  SELECT * INTO v_calc FROM _hub_commission_for_period(v_hub_id, v_period_start, v_cur_start);

  IF COALESCE(v_calc.commission, 0) <= 0 THEN
    RAISE EXCEPTION 'No commission to claim for %', to_char(v_period_start, 'FMMonth YYYY');
  END IF;

  BEGIN
    INSERT INTO expense_claims
      (staff_id, category, description, amount, status, branch_id, hub_id, claim_period)
    VALUES (
      auth.uid(),
      'Hub Commission',
      format('Hub commission — %s — %s · %s delivered orders · base ₹%s @ %s%%',
        v_hub.hub_name,
        to_char(v_period_start, 'FMMonth YYYY'),
        v_calc.delivered_orders,
        v_calc.base_amount,
        v_hub.commission_percent),
      v_calc.commission,
      'Pending',
      v_hub.branch_id,
      v_hub_id,
      v_period_start
    )
    RETURNING id INTO v_claim_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Commission for % has already been claimed', to_char(v_period_start, 'FMMonth YYYY');
  END;

  RETURN jsonb_build_object(
    'claim_id', v_claim_id,
    'period', to_char(v_period_start, 'FMMonth YYYY'),
    'amount', v_calc.commission,
    'status', 'Pending'
  );
END;
$$;

-- ── 5. Grants ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._hub_commission_for_period(INTEGER, DATE, DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hub_commission_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_hub_commission_claim() TO authenticated;
