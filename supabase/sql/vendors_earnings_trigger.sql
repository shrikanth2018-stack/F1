-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Vendor network, part 2: credit on delivery
--
-- When an order reaches 'Delivered', every line belonging to a vendor
-- item credits that vendor's wallet and writes an audit row to
-- vendor_earnings.
--
-- WHY A TRIGGER. An order reaches 'Delivered' by four different routes —
-- a staff status update, an offline-queue replay, advance_orders_status'
-- bulk update, and an admin override. A trigger on `orders` is the only
-- place that catches all four. Putting this in any one code path would
-- silently miss the other three.
--
-- The two selling models pay differently:
--   own_brand    vendor is the seller of record; they receive the sale
--                value LESS your commission.
--   house_brand  you are the seller of record and BOUGHT from them; they
--                receive their agreed cost price, and your margin is the
--                spread. Hence essentials_catalog.vendor_cost below.
--
-- SAFETY. A vendor credit must never block a delivery being recorded.
-- Every item is isolated in its own sub-block and the whole routine is
-- wrapped again, so any failure logs a warning and the delivery still
-- commits — same philosophy as the push fan-out in generate_daily_manifest,
-- which once took the whole dispatch pipeline down.
--
-- IDEMPOTENCE. ux_vendor_earnings_order_item makes a second credit for the
-- same order line impossible at the database level, so a status correction
-- or a replayed offline mutation cannot double-pay.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- Requires: vendors_schema.sql applied first.
-- Rollback: DROP TRIGGER trg_credit_vendor_earnings ON public.orders;
-- ═══════════════════════════════════════════════════════════════

-- ── 1. The agreed cost price for house-brand items ─────────────
-- NULL for own-brand items, where the vendor is paid from the sale price
-- less commission instead.
ALTER TABLE public.essentials_catalog
  ADD COLUMN IF NOT EXISTS vendor_cost NUMERIC
  CHECK (vendor_cost IS NULL OR vendor_cost >= 0);

COMMENT ON COLUMN public.essentials_catalog.vendor_cost IS
  'House-brand only: the agreed rate 1stOne pays the vendor per unit. Own-brand items leave this NULL and are paid from the sale price less commission.';

-- ── 2. Credit every vendor line on one order ───────────────────
CREATE OR REPLACE FUNCTION public.credit_vendor_earnings_for_order(p_order_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            RECORD;
  v_gross      NUMERIC;
  v_net        NUMERIC;
  v_commission NUMERIC;
  v_earning_id BIGINT;
  v_wtx_id     BIGINT;
  v_count      INTEGER := 0;
BEGIN
  FOR r IN
    SELECT oi.id            AS order_item_id,
           oi.quantity      AS quantity,
           oi.price_at_time AS unit_price,
           oi.item_name     AS item_name,
           v.id             AS vendor_id,
           v.owner_user_id  AS owner_user_id,
           v.selling_model  AS selling_model,
           v.commission_percent AS commission_percent,
           ec.vendor_cost   AS vendor_cost
    FROM order_items oi
    JOIN essentials_catalog ec ON ec.id = oi.item_id
    JOIN vendors v             ON v.id = ec.vendor_id
    WHERE oi.order_id = p_order_id
      AND oi.item_type = 'essential'
      AND ec.vendor_id IS NOT NULL
  LOOP
    BEGIN
      v_gross := ROUND(COALESCE(r.unit_price, 0) * COALESCE(r.quantity, 0), 2);

      IF r.selling_model = 'house_brand' THEN
        -- You bought from them: they get their agreed rate, you keep the
        -- spread. A missing cost price is a setup error, not a free item —
        -- record it at zero so it surfaces, and warn.
        IF r.vendor_cost IS NULL THEN
          RAISE WARNING '[credit_vendor_earnings] order % item % is house_brand with no vendor_cost — recorded at zero',
            p_order_id, r.order_item_id;
        END IF;
        v_net := ROUND(COALESCE(r.vendor_cost, 0) * COALESCE(r.quantity, 0), 2);
      ELSE
        -- Marketplace: sale value less your commission.
        v_net := ROUND(v_gross * (1 - COALESCE(r.commission_percent, 0) / 100.0), 2);
      END IF;

      -- Never pay more than the sale brought in, whatever the setup says.
      IF v_net > v_gross THEN
        RAISE WARNING '[credit_vendor_earnings] order % item %: net % exceeded gross % — capped',
          p_order_id, r.order_item_id, v_net, v_gross;
        v_net := v_gross;
      END IF;
      v_commission := ROUND(v_gross - v_net, 2);

      -- ON CONFLICT is the idempotency guard: a re-delivered order simply
      -- finds the row already there and credits nothing further.
      INSERT INTO vendor_earnings (
        vendor_id, order_id, order_item_id, gross_amount,
        commission_percent, commission_amount, net_amount, selling_model
      )
      VALUES (
        r.vendor_id, p_order_id, r.order_item_id, v_gross,
        COALESCE(r.commission_percent, 0), v_commission, v_net, r.selling_model
      )
      ON CONFLICT (order_item_id) DO NOTHING
      RETURNING id INTO v_earning_id;

      IF v_earning_id IS NULL THEN
        CONTINUE;  -- already credited on an earlier transition
      END IF;

      IF v_net > 0 AND r.owner_user_id IS NOT NULL THEN
        -- The wallet holds the BALANCE; vendor_earnings holds the
        -- breakdown. reference_id points back at the earning so the two
        -- always reconcile. p_reference_id is TEXT on this RPC.
        PERFORM increment_wallet_balance(
          r.owner_user_id,
          v_net,
          format('Sale — %s × %s (order #%s)', r.item_name, r.quantity, p_order_id),
          'vendor_sale',
          v_earning_id::text
        );

        SELECT id INTO v_wtx_id
        FROM wallet_transactions
        WHERE user_id = r.owner_user_id
          AND reference_type = 'vendor_sale'
          AND reference_id = v_earning_id::text
        ORDER BY id DESC
        LIMIT 1;

        UPDATE vendor_earnings SET wallet_transaction_id = v_wtx_id WHERE id = v_earning_id;
      END IF;

      v_count := v_count + 1;

    EXCEPTION WHEN OTHERS THEN
      -- One bad line must not cost the vendor their other lines, and must
      -- never block the delivery.
      RAISE WARNING '[credit_vendor_earnings] order % item % failed: %',
        p_order_id, r.order_item_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_vendor_earnings_for_order(BIGINT) FROM PUBLIC, anon, authenticated;

-- ── 3. Fire it the moment an order is delivered ────────────────
CREATE OR REPLACE FUNCTION public.trg_credit_vendor_earnings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM credit_vendor_earnings_for_order(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Belt and braces. Recording the delivery is the operationally
    -- critical act; the money can be reconciled, a lost delivery cannot.
    RAISE WARNING '[trg_credit_vendor_earnings] order % failed: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_vendor_earnings ON public.orders;
CREATE TRIGGER trg_credit_vendor_earnings
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'Delivered' AND OLD.status IS DISTINCT FROM 'Delivered')
  EXECUTE FUNCTION public.trg_credit_vendor_earnings();

-- ── 4. Manual reconciliation helper ────────────────────────────
--   SELECT credit_vendor_earnings_for_order(<order_id>);
-- Safe to re-run at any time — the unique index makes it a no-op for lines
-- already credited. Use it if a delivery predates this trigger, or after
-- fixing a missing vendor_cost.

NOTIFY pgrst, 'reload schema';
