-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Vendor network, part 5: the vendor's own surface
--
-- Three things a vendor needs that they cannot get from the tables
-- directly:
--
--   1. their SUPPLY LIST — what to bring, and when. A vendor is not staff,
--      so `orders_self` gives them no read on orders at all. Rather than
--      widen that policy, this returns a shaped aggregate: item, quantity,
--      date. No customer identity, ever, for a supply-only vendor.
--
--   2. a PAYOUT CLAIM — the wallet holds what they have earned; this turns
--      a balance into an expense_claims row that rides the existing
--      Pending → Approved → Paid flow you already use for hub commission.
--
--   3. the wallet DEBITED when that claim is paid. Without this the
--      balance only ever grows and the vendor appears to be owed money you
--      have already sent them.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- Requires: vendors_schema.sql + vendors_earnings_trigger.sql applied.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. What this vendor must supply, and when ──────────────────
-- Confirmed orders only. An order that is not yet paid must never appear on
-- a vendor's list — they would source goods for a sale that may never
-- happen. That was a deliberate decision, and this WHERE clause is where it
-- actually lives.
CREATE OR REPLACE FUNCTION public.vendor_supply_list()
RETURNS TABLE (
  dispatch_date DATE,
  cycle_id      BIGINT,
  cycle_name    TEXT,
  item_id       BIGINT,
  item_name     TEXT,
  total_qty     BIGINT,
  order_count   BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor_id BIGINT;
BEGIN
  SELECT id INTO v_vendor_id FROM vendors WHERE owner_user_id = auth.uid();
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Not a vendor';
  END IF;

  RETURN QUERY
  SELECT o.dispatch_date,
         o.cycle_id,
         dc.cycle_name,
         oi.item_id,
         oi.item_name,
         SUM(oi.quantity)::BIGINT       AS total_qty,
         COUNT(DISTINCT o.id)::BIGINT   AS order_count
  FROM orders o
  JOIN order_items oi        ON oi.order_id = o.id
  JOIN essentials_catalog ec ON ec.id = oi.item_id
  LEFT JOIN delivery_cycles dc ON dc.id = o.cycle_id
  WHERE ec.vendor_id = v_vendor_id
    AND oi.item_type = 'essential'
    AND o.dispatch_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
    -- Paid and live only. Pending is invisible to a vendor by design.
    AND o.status NOT IN ('Pending', 'Cancelled', 'Failed')
  GROUP BY o.dispatch_date, o.cycle_id, dc.cycle_name, oi.item_id, oi.item_name
  ORDER BY o.dispatch_date, dc.cycle_name NULLS LAST, oi.item_name;
END;
$$;

-- ── 2. Claim a payout ──────────────────────────────────────────
-- The claimable amount is the wallet balance, computed here and never sent
-- by the client — same rule as hub commission. One open claim at a time, so
-- a vendor cannot queue three claims against one balance.
CREATE OR REPLACE FUNCTION public.create_vendor_payout_claim()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor    RECORD;
  v_balance   NUMERIC;
  v_open      BIGINT;
  v_claim_id  BIGINT;
BEGIN
  SELECT id, business_name, branch_id, status
  INTO v_vendor
  FROM vendors WHERE owner_user_id = auth.uid();

  IF v_vendor.id IS NULL THEN
    RAISE EXCEPTION 'Not a vendor';
  END IF;

  SELECT COALESCE(wallet_balance, 0) INTO v_balance
  FROM profiles WHERE id = auth.uid();

  IF v_balance <= 0 THEN
    RAISE EXCEPTION 'There is nothing to claim yet.';
  END IF;

  SELECT count(*) INTO v_open
  FROM expense_claims
  WHERE staff_id = auth.uid()
    AND category = 'Vendor Payout'
    AND status IN ('Pending', 'Approved');
  IF v_open > 0 THEN
    RAISE EXCEPTION 'You already have a payout request in progress.';
  END IF;

  INSERT INTO expense_claims (staff_id, category, description, amount, status, branch_id)
  VALUES (
    auth.uid(),
    'Vendor Payout',
    format('Payout request — %s', COALESCE(v_vendor.business_name, 'vendor')),
    v_balance,
    'Pending',
    v_vendor.branch_id
  )
  RETURNING id INTO v_claim_id;

  RETURN jsonb_build_object('claim_id', v_claim_id, 'amount', v_balance, 'status', 'Pending');
END;
$$;

-- ── 3. Debit the wallet when the payout is actually paid ───────
-- Without this the balance only ever climbs and the vendor looks owed money
-- you already transferred. Fires on the SAME Paid transition the admin
-- already makes in Expense Manager, so there is no second step to remember.
CREATE OR REPLACE FUNCTION public.trg_vendor_payout_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  IF NEW.category <> 'Vendor Payout' THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Guards against paying more than the balance; if the vendor spent some
    -- of it in the app between claiming and being paid, this refuses rather
    -- than driving the wallet negative, and says so in the log.
    SELECT decrement_wallet_balance_if_sufficient(
      NEW.staff_id,
      NEW.amount,
      format('Payout — claim #%s', NEW.id)
    ) INTO v_ok;

    IF NOT v_ok THEN
      RAISE WARNING '[vendor_payout] claim % marked Paid but wallet had less than %; balance NOT debited — reconcile manually',
        NEW.id, NEW.amount;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Marking the claim paid is the admin's act of record; a failed debit
    -- must not undo it. Loud in the log, reconcilable by hand.
    RAISE WARNING '[vendor_payout] claim % debit failed: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendor_payout_paid ON public.expense_claims;
CREATE TRIGGER trg_vendor_payout_paid
  AFTER UPDATE OF status ON public.expense_claims
  FOR EACH ROW
  WHEN (NEW.status = 'Paid' AND OLD.status IS DISTINCT FROM 'Paid')
  EXECUTE FUNCTION public.trg_vendor_payout_paid();

-- ── 4. Grants ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.vendor_supply_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_vendor_payout_claim() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_supply_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_vendor_payout_claim() TO authenticated;

NOTIFY pgrst, 'reload schema';
