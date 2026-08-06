-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Clear the two menu-based subscription plans (2026-08-06)
--
-- Both plans predate the builder change and hold MENU ids in `plan_items`,
-- where a plan now holds building-block ids. Leaving them would break the
-- one thing plan_items is used for at runtime: the subscription-conflict
-- check compares item_ids across plans of the same type, so an old plan
-- holding "Idli Full Plate" and a new one holding "Idli" would not be seen
-- to overlap, and a customer could hold two subscriptions delivering the
-- same food on the same morning.
--
-- Plan #25 additionally carries the price bug this change fixed: ₹115 for
-- THIRTY days of Idli Full Plate (₹50) + Vada Full Plate (₹65) — one day's
-- total, charged once for the whole run. It is `is_active` and live on the
-- customer's Plans page.
--
-- SAFE TO DELETE, checked before writing: `user_subscriptions` is empty, so
-- no customer has ever bought either, and no `orders` row references them.
-- The FK from user_subscriptions would refuse the delete if that changed.
--
-- The owner rebuilds both through the new builder.
--
-- Deploy: supabase db query --linked --file supabase/sql/clear_menu_based_plans_2026_08.sql
-- Idempotent. Safe to re-run (a second run deletes nothing).
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_subs   INTEGER;
  v_orders INTEGER;
  v_gone   INTEGER;
BEGIN
  -- Refuse rather than cascade. If either count is non-zero the assumption
  -- this file rests on has stopped being true, and deleting would orphan a
  -- paying customer's plan.
  SELECT count(*) INTO v_subs
    FROM public.user_subscriptions WHERE plan_id IN (24, 25);
  SELECT count(*) INTO v_orders
    FROM public.orders o
    JOIN public.user_subscriptions us ON us.id = o.subscription_id
   WHERE us.plan_id IN (24, 25);

  IF v_subs > 0 OR v_orders > 0 THEN
    RAISE EXCEPTION
      'Not deleting: % subscription(s) and % order(s) reference plans 24/25. Disable them instead.',
      v_subs, v_orders;
  END IF;

  DELETE FROM public.subscription_plans WHERE id IN (24, 25);
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  RAISE NOTICE '[clear_menu_based_plans] removed % plan(s)', v_gone;
END $$;

-- ── Verification ───────────────────────────────────────────────
-- Every remaining food plan must reference building blocks only. Zero rows.
--
--   SELECT sp.id, sp.plan_name, mi.name AS wrongly_a_menu
--     FROM subscription_plans sp
--     CROSS JOIN LATERAL jsonb_array_elements(sp.plan_items::jsonb) AS it
--     JOIN menu_items mi ON mi.id = (it->>'item_id')::int
--    WHERE COALESCE(sp.plan_type, 'food') = 'food'
--      AND mi.is_customer_visible;

-- ── Rollback ───────────────────────────────────────────────────
-- None. Both plans were trial data with no purchase history; rebuild them
-- in Manage → Subscriptions Manager → + Add Plan.
