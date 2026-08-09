-- ═══════════════════════════════════════════════════════════════════════
-- One cart — pure order rows
--
-- Establishes the invariant the merged cart depends on:
--
--     EVERY orders ROW IS PURE: one dispatch unit, one type.
--     orders.order_type equals the item_type of every line inside it.
--
-- WHY THIS IS NEEDED
--
-- Food and essentials share delivery cycles — cycle 1 is "Breakfast" to food
-- and "Morning" to essentials. Once one cart can hold both, a cycle-keyed
-- grouping would put idli and milk in the SAME row. A mixed row has no
-- correct answer for the packing board, whose state machine differs by type
-- (essentials skip the kitchen: Confirmed → Packed; food goes Ready →
-- Packed). Worse than showing in the wrong tab, a Confirmed essentials line
-- inside a row typed 'food' has NO next status at all, so staff cannot
-- advance it.
--
-- orderBuild.ts now groups by (cycle_id, item_type) and stamps each group
-- with its own type. This file is the database half: let a row say
-- 'subscription', and let place_order_atomic write a type PER ROW instead of
-- one label across the whole checkout.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--
-- Nothing that decides money or fulfilment reads orders.order_type:
--   • credit_vendor_earnings_for_order filters oi.item_type = 'essential'
--   • get_kitchen_aggregate already guards BOTH order_type AND item_type
--   • isOperationalOrder (app) filters on item_type
--   • cancel-order's subscription guard reads item_type
-- They are all item-level already, which is why this surgery is small.
--
-- SAFETY
--
-- Idempotent: the constraint is dropped before it is added, the function is
-- CREATE OR REPLACE, and the backfill is restricted to rows that are already
-- subscription purchases by their line items. Re-running changes nothing.
--
-- DRY-RUN THIS INSIDE BEGIN … ROLLBACK FIRST. There is one database; it is
-- development, preview and production at once.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Let a row say what it actually is ──────────────────────────────
--
-- Same vocabulary as order_items.item_type, which has allowed
-- ('food','essential','subscription') since it was created. Until now the
-- orders table could not say 'subscription', so a plan purchase had to
-- masquerade as food or essential and be told apart by cycle_id IS NULL —
-- an implicit rule that four separate consumers had to know.

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_order_type_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_type_check
  CHECK (order_type = ANY (ARRAY['food'::text, 'essential'::text, 'subscription'::text]));

-- ── 2. Write the type PER ROW ─────────────────────────────────────────
--
-- Backward compatible on purpose: p_order_type stays in the signature and is
-- used whenever a group does not carry its own type. An older deployed
-- function version, or any caller not yet updated, keeps behaving exactly as
-- it does today. That is what allows this file and the edge functions to be
-- applied BEFORE the app ships, with no window where the two disagree.

CREATE OR REPLACE FUNCTION public.place_order_atomic(
  p_user_id             UUID,
  p_status              TEXT,
  p_order_type          TEXT,
  p_delivery_method     TEXT,
  p_hub_id              BIGINT,
  p_payment_method      TEXT,
  p_razorpay_order_id   TEXT,
  p_delivery_address_id BIGINT,
  p_notes               TEXT,
  p_branch_id           BIGINT,
  p_groups              JSONB
)
-- SIGNATURE MUST MATCH THE LIVE FUNCTION EXACTLY — four columns, verified
-- against pg_get_function_result on 9 Aug 2026. CREATE OR REPLACE cannot
-- change a function's OUT-parameter row type, so a mismatch fails outright
-- (which is how this was caught, in a dry run).
--
-- REPLACE, NEVER DROP. The live ACL is `service_role` only: a dropped and
-- recreated function comes back with EXECUTE granted to PUBLIC, which would
-- let any signed-in user write orders directly and bypass every price,
-- cutoff and vendor check in orderBuild. Replacing in place preserves the
-- grant. If a future change ever does need a DROP, it must re-issue:
--   REVOKE ALL ON FUNCTION place_order_atomic(...) FROM PUBLIC;
--   GRANT EXECUTE ON FUNCTION place_order_atomic(...) TO service_role;
RETURNS TABLE (
  new_order_id      BIGINT,
  new_group_id      UUID,
  new_cycle_id      BIGINT,
  new_dispatch_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_group    JSONB;
  v_order_id BIGINT;
  v_group_id UUID := gen_random_uuid();  -- one shared id for the whole checkout
BEGIN
  IF p_groups IS NULL OR jsonb_array_length(p_groups) = 0 THEN
    RAISE EXCEPTION 'place_order_atomic: p_groups must contain at least one dispatch group';
  END IF;

  FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups)
  LOOP
    INSERT INTO orders (
      user_id, total_amount, tax_amount, delivery_fee, status, order_type,
      dispatch_date, cycle_id, delivery_method, hub_id, payment_method,
      razorpay_order_id, wallet_amount_used, delivery_address_id, notes,
      branch_id, order_group_id
    ) VALUES (
      p_user_id,
      (v_group->>'total_amount')::NUMERIC,
      (v_group->>'tax_amount')::NUMERIC,
      (v_group->>'delivery_fee')::NUMERIC,
      p_status,
      -- THE ONE CHANGE. Per-row type when the caller supplies it; the old
      -- order-wide label only when it does not.
      COALESCE(v_group->>'order_type', p_order_type),
      (v_group->>'dispatch_date')::DATE,
      (v_group->>'cycle_id')::BIGINT,
      p_delivery_method,
      p_hub_id,
      p_payment_method,
      p_razorpay_order_id,
      (v_group->>'wallet_amount_used')::NUMERIC,
      p_delivery_address_id,
      p_notes,
      p_branch_id,
      v_group_id
    )
    RETURNING id INTO v_order_id;

    INSERT INTO order_items (order_id, item_id, item_type, item_name, quantity, price_at_time)
    SELECT
      v_order_id,
      (item->>'item_id')::BIGINT,
      item->>'item_type',
      item->>'item_name',
      (item->>'quantity')::INTEGER,
      (item->>'price_at_time')::NUMERIC
    FROM jsonb_array_elements(v_group->'items') AS item;

    new_order_id      := v_order_id;
    new_group_id      := v_group_id;
    new_cycle_id      := (v_group->>'cycle_id')::BIGINT;
    new_dispatch_date := (v_group->>'dispatch_date')::DATE;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ── 3. Backfill the rows that were already subscription purchases ─────
--
-- Identified by their LINES, not by cycle_id being null — the line is the
-- fact, the null cycle was only ever a symptom. A dispatch row (which has a
-- subscription_id and real food/essential lines) is untouched by this,
-- because it has no 'subscription' line of its own.
--
-- Expected: 5 rows on the current database (3 typed 'food', 2 'essential'),
-- all test data. Verify the count before and after.

UPDATE public.orders o
SET order_type = 'subscription'
WHERE o.order_type <> 'subscription'
  AND EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.order_id = o.id AND oi.item_type = 'subscription'
  )
  AND NOT EXISTS (
    -- Belt and braces: never touch a row that also carries a real
    -- fulfilment line. No such row exists today; if one ever did, it would
    -- need a human decision, not a silent relabel.
    SELECT 1 FROM order_items oi
    WHERE oi.order_id = o.id AND oi.item_type IN ('food', 'essential')
  );

-- ── 4. Report — read this, do not trust the exit code ─────────────────

SELECT
  o.order_type,
  (o.cycle_id IS NULL)        AS cycle_null,
  (o.subscription_id IS NULL) AS sub_null,
  count(*)                    AS rows,
  string_agg(DISTINCT oi.item_type, ',') AS item_types
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- Purity check — MUST return zero rows. Any row here holds more than one
-- kind of line, which is the state this whole change exists to prevent.
SELECT o.id, o.order_type, string_agg(DISTINCT oi.item_type, ',') AS types
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.order_type
HAVING count(DISTINCT oi.item_type) > 1;

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK
--
-- Restores the two-value constraint and the single-label write. Only valid
-- while no row is typed 'subscription' — relabel them back first, which the
-- first statement does.
--
--   UPDATE public.orders SET order_type = 'food' WHERE order_type = 'subscription';
--
--   ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
--   ALTER TABLE public.orders ADD CONSTRAINT orders_order_type_check
--     CHECK (order_type = ANY (ARRAY['food'::text, 'essential'::text]));
--
--   -- then re-apply mf10_place_order_atomic.sql to restore p_order_type-only
--   -- writing.
--
-- Note the relabel above cannot restore which rows were food and which were
-- essential. Take the dump first.
-- ═══════════════════════════════════════════════════════════════════════
