-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Custom plans, Phase 2: the manifest emits PURE rows
--
-- A custom plan may hold food AND essentials (at least one food item, then
-- essentials alongside). generate_daily_manifest could not express that: it
-- stamped both the order's order_type and every line's item_type from the
-- PLAN's type, so a mixed plan would have emitted one row typed 'food'
-- containing milk.
--
-- That breaks the invariant the whole operation rests on — a row holds
-- exactly one item_type. get_kitchen_aggregate selects order_type = 'food',
-- the packing tabs split on it, and essentials skip the kitchen entirely
-- (Confirmed → Packed). Milk in a food row would appear on the kitchen board
-- as something to cook and vanish from Packing → Essentials.
--
-- WHAT CHANGES
--   1. Each plan line carries its own `item_type`. Lines written before this
--      have none, so they fall back to the plan's type — exact, not a guess,
--      because every existing plan is single-type.
--   2. One order row per type present, sharing ONE order_group_id, because
--      they are one bag at one door and the packers group by that.
--   3. Name and price are read from the catalogue that line belongs to. The
--      two tables have independent id sequences, so a coalesce across both
--      would price a line from whichever answered first.
--   4. orders_created counts ROWS, not subscriptions.
--
-- A SINGLE-TYPE PLAN COMES OUT BYTE-IDENTICAL. One type present means one
-- iteration, the same columns and the same values as before — the only
-- addition is an explicit order_group_id where the column default previously
-- supplied one. That is what the harness asserts.
--
-- Everything else — the skip rules, the idempotency guard, days_consumed,
-- auto-deactivation, the per-subscription error isolation and the
-- best-effort push — is carried over verbatim from
-- generate_daily_manifest.sql. Re-apply this file after that one if that one
-- is ever edited.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- Verify:  supabase db query --linked --file supabase/tests/manifest_mixed_check.sql
-- ═══════════════════════════════════════════════════════════════

-- ── 1. The uniqueness guard moves to the right grain ───────────
--
-- ux_orders_subscription_dispatch enforced ONE order row per
-- (subscription, dispatch_date). That is the constraint that actually
-- prevents a double dispatch — the EXISTS check inside the function is the
-- polite version; this is the one with teeth.
--
-- It also made a mixed plan impossible. The food row inserted, the
-- essentials row hit the index, the per-subscription handler swallowed the
-- error and moved on: subs_failed incremented, no order reached the kitchen,
-- and nothing surfaced anywhere a person would look. Found by the harness
-- below, which is the only reason this is a paragraph and not an outage.
--
-- Adding order_type keeps the protection at the grain that is now correct:
-- a subscription still cannot dispatch the same TYPE twice on one day, which
-- is the actual double-dispatch being guarded against. What it stops
-- forbidding is the one legitimate case — a food row and an essentials row
-- for the same plan on the same day, which is one bag, not two dispatches.
--
-- DROP then CREATE, not CREATE OR REPLACE: an index definition cannot be
-- replaced in place. The window between them is microseconds on a table this
-- size, and the whole file runs in one transaction.
DROP INDEX IF EXISTS public.ux_orders_subscription_dispatch;

CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_subscription_dispatch_type
  ON public.orders (subscription_id, dispatch_date, order_type)
  WHERE subscription_id IS NOT NULL;


-- ── 2. The manifest itself ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_daily_manifest(
  p_target_date DATE DEFAULT (CURRENT_DATE + INTERVAL '1 day')::DATE,
  p_cycle_id INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_orders_created  INTEGER := 0;
  v_orders_skipped  INTEGER := 0;
  v_subs_skipped    INTEGER := 0;
  v_subs_failed     INTEGER := 0;  -- O3: per-subscription failures, isolated
  v_sub             RECORD;
  v_plan            RECORD;
  v_address         RECORD;
  v_new_order_id    BIGINT;
  v_first_order_id  BIGINT;   -- the row the customer push points at
  v_group_id        UUID;     -- shared by every row of one day's dispatch
  v_default_type    TEXT;     -- fallback for lines written before item_type
  v_type            TEXT;
  v_lines           JSONB;
  v_day_number      INTEGER;
  -- BF-35b: push fan-out for each generated dispatch row. Replaces the
  -- removed _notify_order_status_push trigger so daily sub deliveries
  -- still get a customer "Order Confirmed" push (honoring admin's
  -- notification_templates via send-push's event_key resolution).
  v_supa_url        TEXT;
  v_svc_key         TEXT;
BEGIN
  -- BF-19: store_config tax_rate + delivery_fee lookup removed —
  -- dispatch rows have all financial fields zeroed; no calculation needed.

  -- BF-35b: read pg_net target config once. Null values just mean
  -- pushes are skipped this run; generation still proceeds.
  SELECT value INTO v_supa_url FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_svc_key  FROM app_config WHERE key = 'service_role_key';

  FOR v_sub IN
    SELECT us.id AS sub_id, us.user_id, us.plan_id, us.start_date,
           us.days_consumed, us.payment_method, us.wallet_amount_used
    FROM user_subscriptions us
    JOIN subscription_plans sp ON sp.id = us.plan_id
    WHERE us.is_active = TRUE
      AND us.is_paused = FALSE
      AND (p_cycle_id IS NULL OR sp.cycle_id = p_cycle_id)
  LOOP
    SELECT sp.id, sp.cycle_id, sp.duration_days, sp.price, sp.plan_type, sp.branch_id
    INTO v_plan
    FROM subscription_plans sp
    WHERE sp.id = v_sub.plan_id;

    IF v_plan IS NULL THEN
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    v_day_number := (p_target_date - v_sub.start_date) + 1;
    -- BF-33 / F2.1: end-of-life is driven by days_consumed, not the
    -- calendar window from start_date. Pause / skip / cron-outage now
    -- extend the effective end date so all paid meals get delivered
    -- (spec D-01). Auto-deactivate at the bottom of this loop
    -- (days_consumed + 1 >= duration_days → is_active=false) is the
    -- only stopping condition needed; the outer WHERE is_active=TRUE
    -- filter then takes the sub out next tick.
    IF v_day_number < 1 THEN
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    -- Skip if customer cancelled this specific day
    IF EXISTS (
      SELECT 1 FROM cancelled_subscription_days csd
      WHERE csd.subscription_id = v_sub.sub_id
        AND csd.cancelled_date  = p_target_date
    ) THEN
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    -- Idempotency: already created an order for this (sub, date)?
    IF EXISTS (
      SELECT 1 FROM orders o
      WHERE o.subscription_id = v_sub.sub_id
        AND o.dispatch_date   = p_target_date
    ) THEN
      v_orders_skipped := v_orders_skipped + 1;
      CONTINUE;
    END IF;

    -- Resolve delivery address: default first, fallback to any active
    SELECT ca.id, ca.hub_id, ca.zone_id
    INTO v_address
    FROM customer_addresses ca
    WHERE ca.user_id = v_sub.user_id
      AND ca.is_default = TRUE
      AND ca.is_active = TRUE
    LIMIT 1;

    IF v_address IS NULL THEN
      SELECT ca.id, ca.hub_id, ca.zone_id
      INTO v_address
      FROM customer_addresses ca
      WHERE ca.user_id = v_sub.user_id
        AND ca.is_active = TRUE
      ORDER BY ca.id
      LIMIT 1;
    END IF;

    IF v_address IS NULL THEN
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    -- ── Create the dispatch order ──
    -- BF-19: total_amount = tax_amount = delivery_fee = 0 on dispatch
    -- rows. Revenue is captured at original subscription purchase via
    -- place-order. This row is an operational dispatch record only.
    -- BF-01: wallet_amount_used = 0. Plan was paid in full at purchase;
    -- this is a dispatch event, not a payment event.
    --
    -- O3 (audit): the order + items + days_consumed write for ONE
    -- subscription is isolated in its own sub-block. A failure here is
    -- logged + counted and the loop moves on — one bad subscription can
    -- no longer abort the whole manifest run for everyone else.
    -- A line written before mixed plans existed carries no item_type, so the
    -- plan's own type is what it meant. Every such plan is single-type, which
    -- is why the fallback is exact rather than a guess.
    v_default_type := CASE WHEN COALESCE(v_plan.plan_type, 'food') = 'food'
                           THEN 'food' ELSE 'essential' END;

    BEGIN
    -- Resolve every line once, each carrying its OWN type.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'item_id',   (item->>'item_id')::INTEGER,
             'item_type', COALESCE(NULLIF(item->>'item_type', ''), v_default_type),
             'item_name', item->>'item_name',
             'quantity',  COALESCE((item->>'quantity')::INTEGER, 1)
           )), '[]'::jsonb)
      INTO v_lines
      FROM subscription_plans sp2
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE jsonb_typeof(sp2.plan_items::jsonb)
          WHEN 'array' THEN sp2.plan_items::jsonb
          ELSE '[]'::jsonb
        END
      ) AS item
     WHERE sp2.id = v_sub.plan_id;

    -- ONE GROUP ID FOR THE WHOLE DAY'S DISPATCH. The rows below are one bag
    -- arriving at one door in one window; the packers group by
    -- (order_group_id, cycle, dispatch_date), so separate ids would print two
    -- slips and pack two bags for a single delivery.
    v_group_id := gen_random_uuid();
    v_first_order_id := NULL;

    -- ONE ROW PER TYPE. A row must hold exactly one item_type: the kitchen
    -- aggregate selects order_type = 'food', the packing tabs split on it and
    -- essentials skip the kitchen entirely. A mixed plan written into a
    -- single row would put milk on the kitchen board and lose it from
    -- Packing -> Essentials.
    FOR v_type IN
      SELECT DISTINCT l->>'item_type' FROM jsonb_array_elements(v_lines) AS l ORDER BY 1
    LOOP
      INSERT INTO orders (
        user_id, subscription_id, total_amount, tax_amount, delivery_fee,
        status, order_type, dispatch_date, cycle_id,
        delivery_method, hub_id, payment_method, wallet_amount_used,
        delivery_address_id, branch_id, order_group_id
      )
      VALUES (
        v_sub.user_id, v_sub.sub_id,
        0,  -- BF-19: dispatch rows are not revenue events
        0,  -- BF-19: tax was paid at original purchase
        0,  -- BF-19: delivery fee was paid at original purchase
        'Confirmed',
        v_type,
        p_target_date, v_plan.cycle_id,
        CASE WHEN v_address.hub_id IS NOT NULL THEN 'hub' ELSE 'direct' END,
        v_address.hub_id, v_sub.payment_method,
        0,  -- BF-01: no wallet debit on dispatch
        v_address.id, v_plan.branch_id, v_group_id
      )
      RETURNING id INTO v_new_order_id;

      IF v_first_order_id IS NULL THEN v_first_order_id := v_new_order_id; END IF;

      -- Name and price come from the catalogue THIS line belongs to. The two
      -- tables have independent id sequences, so menu item 9 and essential 9
      -- are different products -- joining both and coalescing would price a
      -- line from whichever table happened to answer first.
      INSERT INTO order_items (order_id, item_id, item_type, item_name, quantity, price_at_time)
      SELECT
        v_new_order_id,
        (l->>'item_id')::INTEGER,
        v_type,
        COALESCE(NULLIF(l->>'item_name', ''), mi.name, ec.name, 'Item #' || (l->>'item_id')),
        (l->>'quantity')::INTEGER,
        COALESCE(mi.price, ec.price, 0)
      FROM jsonb_array_elements(v_lines) AS l
      LEFT JOIN menu_items mi
        ON v_type = 'food' AND mi.id = (l->>'item_id')::INTEGER
      LEFT JOIN essentials_catalog ec
        ON v_type = 'essential' AND ec.id = (l->>'item_id')::INTEGER
      WHERE l->>'item_type' = v_type;

      v_orders_created := v_orders_created + 1;
    END LOOP;

    -- A PLAN WITH NO LINES STILL PRODUCES ONE ROW, and it must.
    --
    -- The idempotency guard above is "does an order already exist for this
    -- (subscription, date)". Creating nothing would leave that guard with
    -- nothing to find, so every retry of the per-minute tick would run this
    -- subscription again and increment days_consumed again -- burning a paid
    -- plan down in minutes. An empty order is odd; a self-consuming
    -- subscription is a refund and an apology.
    IF v_first_order_id IS NULL THEN
      INSERT INTO orders (
        user_id, subscription_id, total_amount, tax_amount, delivery_fee,
        status, order_type, dispatch_date, cycle_id,
        delivery_method, hub_id, payment_method, wallet_amount_used,
        delivery_address_id, branch_id, order_group_id
      )
      VALUES (
        v_sub.user_id, v_sub.sub_id, 0, 0, 0, 'Confirmed', v_default_type,
        p_target_date, v_plan.cycle_id,
        CASE WHEN v_address.hub_id IS NOT NULL THEN 'hub' ELSE 'direct' END,
        v_address.hub_id, v_sub.payment_method, 0,
        v_address.id, v_plan.branch_id, v_group_id
      )
      RETURNING id INTO v_new_order_id;
      v_first_order_id := v_new_order_id;
      v_orders_created := v_orders_created + 1;
    END IF;

    -- The push names one order; the first row of the bag is that one.
    v_new_order_id := v_first_order_id;


    -- Increment consumption + auto-deactivate when complete
    UPDATE user_subscriptions
    SET days_consumed = days_consumed + 1,
        is_active = CASE
          WHEN days_consumed + 1 >= v_plan.duration_days THEN FALSE
          ELSE TRUE
        END
    WHERE id = v_sub.sub_id;
    EXCEPTION WHEN OTHERS THEN
      -- O3: this one subscription failed — count it, log it, and move on.
      -- The sub-block's savepoint rolls back just this subscription's
      -- partial writes; the rest of the run is unaffected.
      v_subs_failed := v_subs_failed + 1;
      RAISE WARNING '[generate_daily_manifest] subscription % failed: %',
        v_sub.sub_id, SQLERRM;
      CONTINUE;
    END;

    -- BF-35b: fire customer "Order Confirmed" push via pg_net. Async,
    -- non-blocking — generation proceeds even if send-push is down.
    -- Uses event_key so admin's notification_templates override applies;
    -- fallback title/body provided in case the template row is missing.
    --
    -- AUDIT-FIX (2026-05-19): this push call took the whole subscription
    -- dispatch pipeline DOWN in production. Two corrections:
    --   1. `body` is passed as JSONB, not ::text. Current pg_net has no
    --      net.http_post(..., body => text) overload, so the ::text cast
    --      raised "function does not exist" on every dispatch — and the
    --      manifest's outer handler re-RAISEs, rolling back the order,
    --      its items, days_consumed AND the kitchen_push_log row.
    --   2. The call is wrapped in its own BEGIN/EXCEPTION block. A push
    --      enqueue failure must NEVER abort the dispatch — the order is
    --      already inserted above; a notification problem cannot be
    --      allowed to roll back a paid customer's meal.
    IF v_supa_url IS NOT NULL AND v_svc_key IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url     := v_supa_url || '/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || v_svc_key
          ),
          body    := jsonb_build_object(
            'user_ids',       jsonb_build_array(v_sub.user_id::text),
            'event_key',      'order.confirmed',
            'vars',           jsonb_build_object('order_id', v_new_order_id),
            'title',          'Order Confirmed!',
            'body',           'Your order #' || v_new_order_id || ' is confirmed. We''re getting it ready!',
            'data',           jsonb_build_object(
                                'screen', 'OrderDetail',
                                'params', jsonb_build_object('orderId', v_new_order_id)
                              ),
            'trigger_source', 'subscription_dispatch',
            'reference_id',   v_new_order_id::text
          )
        );
      EXCEPTION WHEN OTHERS THEN
        -- Push is best-effort. Swallow ANY failure so the dispatch commits.
        RAISE WARNING '[generate_daily_manifest] push enqueue failed for order %: %',
          v_new_order_id, SQLERRM;
      END;
    END IF;

    -- v_orders_created is incremented per ORDER ROW above, not here: a mixed
    -- plan produces two rows for one subscription and the log should say so.
  END LOOP;

  -- Audit log — error_detail notes any per-subscription failures (O3).
  INSERT INTO manifest_run_log (run_date, orders_created, orders_skipped, subs_skipped, error_detail)
  VALUES (p_target_date, v_orders_created, v_orders_skipped, v_subs_skipped,
          CASE WHEN v_subs_failed > 0
               THEN v_subs_failed || ' subscription(s) failed — see WARNING logs'
               ELSE NULL END);

  RETURN jsonb_build_object(
    'target_date',     p_target_date,
    'orders_created',  v_orders_created,
    'orders_skipped',  v_orders_skipped,
    'subs_skipped',    v_subs_skipped,
    'subs_failed',     v_subs_failed
  );

EXCEPTION WHEN OTHERS THEN
  INSERT INTO manifest_run_log (run_date, orders_created, orders_skipped, subs_skipped, error_detail)
  VALUES (p_target_date, v_orders_created, v_orders_skipped, v_subs_skipped, SQLERRM);
  RAISE;
END;
$$;
