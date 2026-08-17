


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."_hub_commission_for_period"("p_hub_id" integer, "p_start" "date", "p_next_start" "date") RETURNS TABLE("delivered_orders" bigint, "base_amount" numeric, "commission" numeric)
    LANGUAGE "sql" STABLE
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


ALTER FUNCTION "public"."_hub_commission_for_period"("p_hub_id" integer, "p_start" "date", "p_next_start" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_kitchen_get_secret"("p_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
DECLARE
  v_secret TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = p_name
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;   -- vault extension absent / not readable
  END;

  IF v_secret IS NULL THEN
    SELECT value INTO v_secret FROM app_config WHERE key = p_name LIMIT 1;
  END IF;

  RETURN v_secret;
END;
$$;


ALTER FUNCTION "public"."_kitchen_get_secret"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_undelivered_order_ids"("p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("order_id" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH latest_push AS (
    -- The active batch per branch. Same ordering — including the id tiebreak —
    -- as get_active_staff_batch and vendor_orders(), so all three agree on
    -- which batch is live. See undelivered_batch_alert.sql for why pushed_at
    -- alone is a partial order.
    SELECT DISTINCT ON (dc.branch_id)
           dc.branch_id, kpl.cycle_id, kpl.push_date
    FROM kitchen_push_log kpl
    JOIN delivery_cycles dc ON dc.id = kpl.cycle_id
    ORDER BY dc.branch_id, kpl.pushed_at DESC, kpl.id DESC
  )
  SELECT o.id::BIGINT
  FROM orders o
  LEFT JOIN delivery_cycles odc ON odc.id = o.cycle_id
  LEFT JOIN latest_push lp ON lp.branch_id IS NOT DISTINCT FROM odc.branch_id
  WHERE (p_user_id IS NULL OR o.user_id = p_user_id)
    AND o.status NOT IN ('Delivered', 'Cancelled', 'Failed')
    -- A subscription PURCHASE delivers nothing — it is a revenue row with no
    -- cycle. Without this it would age past its date and be reported for ever
    -- as an undelivered order that never existed.
    AND o.cycle_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = o.id AND oi.item_type IN ('food', 'essential')
    )
    -- Never the batch currently on the boards: that work is in progress, not
    -- lost.
    AND NOT (lp.cycle_id = o.cycle_id AND lp.push_date = o.dispatch_date)
    AND (
      -- Released at some point and since replaced …
      EXISTS (
        SELECT 1 FROM kitchen_push_log k
        WHERE k.cycle_id = o.cycle_id AND k.push_date = o.dispatch_date
      )
      -- … or its date passed without ever being released, which is what a
      -- missed cron looks like.
      OR o.dispatch_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
    )
  ORDER BY o.dispatch_date, o.id;
$$;


ALTER FUNCTION "public"."_undelivered_order_ids"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_or_merge_supply_order_item"("p_name" "text", "p_qty" integer, "p_category" "text", "p_request_id" bigint, "p_added_by" "uuid", "p_branch_id" integer) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_existing_id BIGINT;
  v_trimmed TEXT;
BEGIN
  v_trimmed := trim(COALESCE(p_name, ''));
  IF length(v_trimmed) = 0 THEN
    RAISE EXCEPTION 'name required';
  END IF;
  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION 'qty must be >= 1';
  END IF;
  IF p_category NOT IN ('Vegetables', 'Grocery', 'Stationery') THEN
    RAISE EXCEPTION 'invalid category: %', p_category;
  END IF;

  SELECT id INTO v_existing_id
  FROM public.supply_order_items
  WHERE category = p_category
    AND lower(trim(name)) = lower(v_trimmed)
    AND batch_id IS NULL
    AND COALESCE(branch_id, 0) = COALESCE(p_branch_id, 0)
  ORDER BY id ASC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.supply_order_items SET qty = qty + p_qty WHERE id = v_existing_id;
    RETURN v_existing_id;
  ELSE
    INSERT INTO public.supply_order_items (
      name, qty, category, request_id, batch_id, added_by, branch_id
    ) VALUES (
      v_trimmed, p_qty, p_category, p_request_id, NULL, p_added_by, p_branch_id
    )
    RETURNING id INTO v_existing_id;
    RETURN v_existing_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."add_or_merge_supply_order_item"("p_name" "text", "p_qty" integer, "p_category" "text", "p_request_id" bigint, "p_added_by" "uuid", "p_branch_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_cancel_order_atomic"("p_order_id" bigint, "p_refund_amount" numeric, "p_reason" "text" DEFAULT 'Cancelled by admin'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id        UUID;
  v_current_status TEXT;
  v_dispatch_date  DATE;
  v_admin_id       UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may cancel orders';
  END IF;

  v_admin_id := auth.uid();

  IF p_refund_amount IS NULL OR p_refund_amount < 0 THEN
    RAISE EXCEPTION 'refund amount must be >= 0 (got %)', p_refund_amount;
  END IF;

  -- Lock the order row + read current state. FOR UPDATE prevents two
  -- concurrent admin cancellations from both processing the same row.
  SELECT user_id, status, dispatch_date
  INTO v_user_id, v_current_status, v_dispatch_date
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;

  IF v_current_status = 'Cancelled' THEN
    RAISE EXCEPTION 'order % is already Cancelled', p_order_id;
  END IF;

  -- A delivered order is complete — never cancel/refund it.
  IF v_current_status = 'Delivered' THEN
    RAISE EXCEPTION 'order % is Delivered — cannot cancel a completed delivery', p_order_id;
  END IF;

  -- D2: a dispatched-stage order is cancellable ONLY once it is an
  -- "unsuccessful delivery" — past its dispatch date (IST), never delivered.
  -- A dispatch still within its window must not be cancelled (may yet land).
  IF v_current_status IN ('Dispatched', 'On the Way', 'Received at Hub')
     AND (v_dispatch_date IS NULL
          OR v_dispatch_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date) THEN
    RAISE EXCEPTION 'order % is % and still within its delivery window — cannot cancel',
      p_order_id, v_current_status;
  END IF;

  -- 1. Cancel the order, APPENDING the reason so prior notes survive.
  UPDATE orders
  SET status     = 'Cancelled',
      notes      = COALESCE(notes || ' | ', '') || '[Admin cancel: ' || p_reason || ']',
      updated_at = NOW()
  WHERE id = p_order_id;

  -- 2. Credit wallet (only if refund > 0). Uses existing
  -- increment_wallet_balance RPC so wallet logic stays centralized.
  IF p_refund_amount > 0 THEN
    PERFORM public.increment_wallet_balance(
      v_user_id,
      p_refund_amount,
      'Refund — order #' || p_order_id || ' cancelled by admin',
      'order_refund',
      p_order_id::text
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id',      p_order_id,
    'user_id',       v_user_id,
    'refund_amount', p_refund_amount,
    'cancelled_at',  NOW(),
    'cancelled_by',  v_admin_id
  );
END;
$$;


ALTER FUNCTION "public"."admin_cancel_order_atomic"("p_order_id" bigint, "p_refund_amount" numeric, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_cancel_subscription_atomic"("p_subscription_id" bigint, "p_refund_amount" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id     UUID;
  v_sub_active  BOOLEAN;
  v_admin_id    UUID;
BEGIN
  -- Gate: only admin can cancel + refund a subscription
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may cancel subscriptions';
  END IF;

  v_admin_id := auth.uid();

  -- Validate inputs
  IF p_refund_amount IS NULL OR p_refund_amount < 0 THEN
    RAISE EXCEPTION 'refund amount must be >= 0 (got %)', p_refund_amount;
  END IF;

  -- Lock the subscription row + read state. FOR UPDATE prevents two
  -- concurrent admin cancellations from both processing the same row.
  SELECT user_id, is_active
  INTO v_user_id, v_sub_active
  FROM user_subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'subscription % not found', p_subscription_id;
  END IF;

  IF NOT v_sub_active THEN
    RAISE EXCEPTION 'subscription % is already inactive — cannot cancel again', p_subscription_id;
  END IF;

  -- 1. Deactivate subscription
  UPDATE user_subscriptions
  SET is_active   = FALSE,
      is_paused   = FALSE,
      updated_at  = NOW()
  WHERE id = p_subscription_id;

  -- 2. Credit wallet (only if refund > 0).
  -- Uses existing increment_wallet_balance RPC — wallet logic
  -- (UPDATE profiles + INSERT wallet_transactions) stays centralized
  -- there. Both calls run in this function's transaction; if either
  -- raises, the whole atomic flow rolls back.
  IF p_refund_amount > 0 THEN
    PERFORM public.increment_wallet_balance(
      v_user_id,
      p_refund_amount,
      'Prorated refund — subscription #' || p_subscription_id || ' cancelled by admin',
      'subscription_refund',
      p_subscription_id::text
    );
  END IF;

  -- Return summary for client confirmation UI
  RETURN jsonb_build_object(
    'subscription_id', p_subscription_id,
    'user_id',         v_user_id,
    'refund_amount',   p_refund_amount,
    'cancelled_at',    NOW(),
    'cancelled_by',    v_admin_id
  );
END;
$$;


ALTER FUNCTION "public"."admin_cancel_subscription_atomic"("p_subscription_id" bigint, "p_refund_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_essential"("p_name" "text", "p_price" numeric, "p_cycle_id" integer, "p_branch_id" integer, "p_unit" "text" DEFAULT 'unit'::"text", "p_description" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_id INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only.';
  END IF;
  IF NOT public.has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'That branch is not yours.';
  END IF;

  INSERT INTO public.essentials_catalog
    (name, price, unit, cycle_id, description, branch_id,
     is_active, sort_order, listing_status)
  VALUES
    (TRIM(p_name), p_price, COALESCE(NULLIF(TRIM(p_unit), ''), 'unit'),
     p_cycle_id, NULLIF(TRIM(p_description), ''), p_branch_id,
     TRUE, 0, 'approved')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."admin_create_essential"("p_name" "text", "p_price" numeric, "p_cycle_id" integer, "p_branch_id" integer, "p_unit" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_menu_block"("p_name" "text", "p_price" numeric, "p_branch_id" integer, "p_unit" "text" DEFAULT 'nos'::"text", "p_base_qty" numeric DEFAULT 1) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_id INTEGER;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only.'; END IF;
  IF NOT public.has_branch_access(p_branch_id) THEN RAISE EXCEPTION 'That branch is not yours.'; END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'Enter a name.'; END IF;
  IF position(':' IN p_name) > 0 OR position(';' IN p_name) > 0 THEN
    RAISE EXCEPTION 'A name cannot contain ":" or ";" — they separate the parts of a recipe.';
  END IF;

  INSERT INTO public.menu_items
    (name, price, unit, base_quantity, cycle_id, ingredients,
     is_active, is_customer_visible, branch_id, sort_order)
  VALUES
    (btrim(p_name), COALESCE(p_price, 0),
     CASE WHEN p_unit IN ('nos','gms','ml','cup','plate','bowl') THEN p_unit ELSE 'nos' END,
     CASE WHEN COALESCE(p_base_qty, 1) > 0 THEN p_base_qty ELSE 1 END,
     NULL, NULL, TRUE, FALSE, p_branch_id, 0)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;


ALTER FUNCTION "public"."admin_create_menu_block"("p_name" "text", "p_price" numeric, "p_branch_id" integer, "p_unit" "text", "p_base_qty" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_issue_referral_month_bonus"("p_referral_id" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_referrer UUID;
  v_status   TEXT;
  v_given    BOOLEAN;
  v_amount   NUMERIC;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only.';
  END IF;

  -- Lock the row so two admins pressing at once cannot both pay.
  SELECT referrer_id, status, COALESCE(month_reward_given, FALSE)
    INTO v_referrer, v_status, v_given
  FROM referrals WHERE id = p_referral_id FOR UPDATE;

  IF v_referrer IS NULL THEN
    RAISE EXCEPTION 'Referral % not found.', p_referral_id;
  END IF;
  IF v_given THEN
    RAISE EXCEPTION 'That month bonus has already been issued.';
  END IF;

  SELECT COALESCE(referrer_month_credit, 0) INTO v_amount
  FROM referral_settings ORDER BY id LIMIT 1;

  -- Credit and record in ONE transaction. A zero configured bonus still
  -- marks the referral complete — the admin's decision is the event, and the
  -- amount happening to be zero is not a reason to leave it re-issuable.
  IF COALESCE(v_amount, 0) > 0 THEN
    PERFORM public.increment_wallet_balance(
      v_referrer, v_amount,
      'Referral bonus — friend completed first month',
      'referral_month_bonus', p_referral_id::text);
  END IF;

  UPDATE referrals
     SET status = 'month_complete', month_reward_given = TRUE
   WHERE id = p_referral_id;

  RETURN jsonb_build_object('referral_id', p_referral_id,
                            'referrer_id', v_referrer,
                            'amount', COALESCE(v_amount, 0));
END;
$$;


ALTER FUNCTION "public"."admin_issue_referral_month_bonus"("p_referral_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_onboard_vendor"("p_user_id" "uuid", "p_business_name" "text", "p_contact_phone" "text" DEFAULT NULL::"text", "p_selling_model" "text" DEFAULT 'own_brand'::"text", "p_supply_mode" "text" DEFAULT 'they_drop'::"text", "p_commission_percent" numeric DEFAULT 0, "p_branch_id" integer DEFAULT NULL::integer) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_vendor_id BIGINT;
  v_branch_id INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may onboard vendors';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'That person is not a registered user yet. Register them first.';
  END IF;

  IF EXISTS (SELECT 1 FROM vendors WHERE owner_user_id = p_user_id) THEN
    RAISE EXCEPTION 'This person is already a vendor.';
  END IF;

  -- Default the vendor to the person's own branch. Where they may SELL is
  -- a separate thing entirely (vendor_zones) — a Siddapur producer will
  -- eventually sell into Bangalore.
  SELECT COALESCE(p_branch_id, branch_id, 1) INTO v_branch_id
  FROM profiles WHERE id = p_user_id;

  INSERT INTO vendors (
    owner_user_id, branch_id, business_name, contact_phone,
    selling_model, supply_mode, commission_percent,
    status, invited_by
  ) VALUES (
    p_user_id, v_branch_id, NULLIF(btrim(p_business_name), ''), p_contact_phone,
    p_selling_model, p_supply_mode, COALESCE(p_commission_percent, 0),
    'invited', auth.uid()
  )
  RETURNING id INTO v_vendor_id;

  -- profiles.vendor_id is not grantable to authenticated, so it can only be
  -- set from in here. Kept in step with vendors.owner_user_id so a future
  -- JWT claim (like assigned_hub_id) can read it without a backfill.
  UPDATE profiles SET vendor_id = v_vendor_id WHERE id = p_user_id;

  RETURN v_vendor_id;
END;
$$;


ALTER FUNCTION "public"."admin_onboard_vendor"("p_user_id" "uuid", "p_business_name" "text", "p_contact_phone" "text", "p_selling_model" "text", "p_supply_mode" "text", "p_commission_percent" numeric, "p_branch_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_remove_menu_item"("p_id" integer) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_row public.menu_items; v_used INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only.';
  END IF;

  SELECT * INTO v_row FROM public.menu_items WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found.';
  END IF;
  IF NOT public.has_branch_access(v_row.branch_id) THEN
    RAISE EXCEPTION 'That item belongs to another branch.';
  END IF;

  -- A block still named by a live recipe must not vanish underneath it.
  IF NOT v_row.is_customer_visible THEN
    v_used := public.menu_block_usage(v_row.name);
    IF v_used > 0 THEN
      RAISE EXCEPTION 'Still used by % menu(s). Remove it from those first.', v_used;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_items WHERE item_id = p_id
               AND (item_type IS NULL OR item_type = 'food')) THEN
    UPDATE public.menu_items SET is_active = FALSE WHERE id = p_id;
    RETURN 'retired';
  END IF;

  DELETE FROM public.menu_items WHERE id = p_id;
  RETURN 'deleted';
END $$;


ALTER FUNCTION "public"."admin_remove_menu_item"("p_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rename_menu_block"("p_old" "text", "p_new" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_recipes INTEGER := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only.';
  END IF;
  IF COALESCE(btrim(p_new), '') = '' THEN
    RAISE EXCEPTION 'Enter a name.';
  END IF;
  IF position(':' IN p_new) > 0 OR position(';' IN p_new) > 0 THEN
    RAISE EXCEPTION 'A name cannot contain ":" or ";" — they separate the parts of a recipe.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.menu_items
             WHERE NOT is_customer_visible
               AND lower(name) = lower(btrim(p_new))
               AND lower(name) <> lower(btrim(p_old))) THEN
    RAISE EXCEPTION 'An item called "%" already exists.', btrim(p_new);
  END IF;

  UPDATE public.menu_items
     SET name = btrim(p_new)
   WHERE NOT is_customer_visible AND lower(name) = lower(btrim(p_old));

  WITH rebuilt AS (
    SELECT mi.id,
           string_agg(
             CASE WHEN lower(btrim(split_part(c.chunk, ':', 1))) = lower(btrim(p_old))
                  THEN btrim(p_new) || ':' || btrim(split_part(c.chunk, ':', 2))
                  ELSE btrim(c.chunk) END,
             ';' ORDER BY c.ord) AS ing
    FROM public.menu_items mi,
         LATERAL regexp_split_to_table(mi.ingredients, ';') WITH ORDINALITY AS c(chunk, ord)
    WHERE mi.is_customer_visible
      AND mi.ingredients IS NOT NULL AND btrim(mi.ingredients) <> ''
      AND btrim(c.chunk) <> ''
    GROUP BY mi.id)
  UPDATE public.menu_items m
     SET ingredients = r.ing
    FROM rebuilt r
   WHERE m.id = r.id AND m.ingredients IS DISTINCT FROM r.ing;

  GET DIAGNOSTICS v_recipes = ROW_COUNT;
  RETURN v_recipes;
END $$;


ALTER FUNCTION "public"."admin_rename_menu_block"("p_old" "text", "p_new" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_review_listing"("p_item_id" integer, "p_approve" boolean, "p_reason" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row public.essentials_catalog;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only.';
  END IF;

  SELECT * INTO v_row FROM public.essentials_catalog WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found.';
  END IF;
  IF NOT public.has_branch_access(v_row.branch_id) THEN
    RAISE EXCEPTION 'That item belongs to another branch.';
  END IF;
  IF v_row.listing_status <> 'pending' THEN
    RAISE EXCEPTION 'That item is not waiting for review.';
  END IF;

  IF p_approve THEN
    -- Belt and braces: the submit RPC already refuses a photo-less item, but
    -- approval is the last gate before a customer sees it.
    IF v_row.image_path IS NULL THEN
      RAISE EXCEPTION 'This listing has no photo and cannot be approved.';
    END IF;
    UPDATE public.essentials_catalog
       SET listing_status = 'approved',
           is_active      = TRUE,
           reviewed_at    = NOW(),
           reviewed_by    = auth.uid(),
           rejection_reason = NULL
     WHERE id = p_item_id;
  ELSE
    UPDATE public.essentials_catalog
       SET listing_status   = 'rejected',
           is_active        = FALSE,
           reviewed_at      = NOW(),
           reviewed_by      = auth.uid(),
           rejection_reason = NULLIF(TRIM(COALESCE(p_reason, '')), '')
     WHERE id = p_item_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."admin_review_listing"("p_item_id" integer, "p_approve" boolean, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_review_listing_change"("p_change_id" bigint, "p_approve" boolean, "p_reason" "text" DEFAULT NULL::"text", "p_photo_promoted" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_ch  public.vendor_listing_changes;
  v_row public.essentials_catalog;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only.';
  END IF;

  SELECT * INTO v_ch FROM public.vendor_listing_changes WHERE id = p_change_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found.';
  END IF;
  IF v_ch.status <> 'pending' THEN
    RAISE EXCEPTION 'That request has already been dealt with.';
  END IF;

  SELECT * INTO v_row FROM public.essentials_catalog WHERE id = v_ch.item_id;
  IF NOT public.has_branch_access(v_row.branch_id) THEN
    RAISE EXCEPTION 'That item belongs to another branch.';
  END IF;

  IF p_approve THEN
    -- Field by field, never a wholesale jsonb apply — a key that should not
    -- be in `proposed` must not be able to become a column write. This is the
    -- reason vendor_cost and commission cannot ride in on a change request.
    UPDATE public.essentials_catalog
       SET name        = COALESCE(v_ch.proposed->>'name', name),
           price       = COALESCE((v_ch.proposed->>'price')::NUMERIC, price),
           unit        = COALESCE(v_ch.proposed->>'unit', unit),
           cycle_id    = COALESCE((v_ch.proposed->>'cycle_id')::INTEGER, cycle_id),
           description = CASE WHEN v_ch.proposed ? 'description'
                              THEN NULLIF(TRIM(v_ch.proposed->>'description'), '')
                              ELSE description END,
           image_updated_at = CASE WHEN p_photo_promoted THEN NOW() ELSE image_updated_at END
     WHERE id = v_ch.item_id;
  END IF;

  UPDATE public.vendor_listing_changes
     SET status           = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         reviewed_at      = NOW(),
         reviewed_by      = auth.uid(),
         rejection_reason = CASE WHEN p_approve THEN NULL
                                 ELSE NULLIF(TRIM(COALESCE(p_reason, '')), '') END
   WHERE id = p_change_id;
END;
$$;


ALTER FUNCTION "public"."admin_review_listing_change"("p_change_id" bigint, "p_approve" boolean, "p_reason" "text", "p_photo_promoted" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_menu_block_unit"("p_id" integer, "p_unit" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE v_name TEXT; v_recipes INTEGER := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only.'; END IF;
  IF p_unit NOT IN ('nos','gms','ml','cup','plate','bowl') THEN
    RAISE EXCEPTION 'Unknown unit "%".', p_unit;
  END IF;

  SELECT name INTO v_name FROM public.menu_items WHERE id = p_id AND NOT is_customer_visible;
  IF NOT FOUND THEN RAISE EXCEPTION 'Menu item not found.'; END IF;

  UPDATE public.menu_items SET unit = p_unit WHERE id = p_id;

  WITH rebuilt AS (
    SELECT mi.id,
           string_agg(
             CASE WHEN lower(btrim(split_part(ch.chunk, ':', 1))) = lower(v_name)
                  THEN btrim(split_part(ch.chunk, ':', 1)) || ':'
                       || btrim(regexp_replace(btrim(split_part(ch.chunk, ':', 2)), '\s*[A-Za-z]+\s*$', ''))
                       || ' ' || p_unit
                  ELSE btrim(ch.chunk) END,
             ';' ORDER BY ch.ord) AS ing
    FROM public.menu_items mi
    CROSS JOIN LATERAL regexp_split_to_table(mi.ingredients, ';') WITH ORDINALITY AS ch(chunk, ord)
    WHERE mi.is_customer_visible AND mi.ingredients IS NOT NULL AND btrim(ch.chunk) <> ''
    GROUP BY mi.id)
  UPDATE public.menu_items m SET ingredients = r.ing
    FROM rebuilt r WHERE m.id = r.id AND m.ingredients IS DISTINCT FROM r.ing;

  GET DIAGNOSTICS v_recipes = ROW_COUNT;
  RETURN v_recipes;
END $_$;


ALTER FUNCTION "public"."admin_set_menu_block_unit"("p_id" integer, "p_unit" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_vendor_status"("p_vendor_id" bigint, "p_status" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_before TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may change vendor status';
  END IF;
  IF p_status NOT IN ('invited', 'submitted', 'approved', 'suspended', 'rejected') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  SELECT status INTO v_before FROM vendors WHERE id = p_vendor_id FOR UPDATE;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'vendor % not found', p_vendor_id;
  END IF;

  UPDATE vendors
  SET status      = p_status,
      admin_note  = COALESCE(p_note, admin_note),
      approved_by = CASE WHEN p_status = 'approved' THEN auth.uid() ELSE approved_by END,
      approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE approved_at END,
      updated_at  = now()
  WHERE id = p_vendor_id;

  -- Suspension takes their catalogue down immediately. Orders already
  -- placed are honoured and any balance stays claimable — only new selling
  -- stops. Re-approving does NOT auto-relist; the vendor turns items back
  -- on themselves, so nothing they meant to retire quietly reappears.
  IF p_status IN ('suspended', 'rejected') THEN
    UPDATE essentials_catalog
    SET is_active = FALSE
    WHERE vendor_id = p_vendor_id AND is_active = TRUE;
  END IF;

  RETURN jsonb_build_object(
    'vendor_id', p_vendor_id, 'from', v_before, 'to', p_status
  );
END;
$$;


ALTER FUNCTION "public"."admin_set_vendor_status"("p_vendor_id" bigint, "p_status" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_vendor_terms"("p_vendor_id" bigint, "p_commission_percent" numeric DEFAULT NULL::numeric, "p_selling_model" "text" DEFAULT NULL::"text", "p_supply_mode" "text" DEFAULT NULL::"text", "p_return_policy" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may set vendor terms';
  END IF;
  IF p_commission_percent IS NOT NULL
     AND (p_commission_percent < 0 OR p_commission_percent > 100) THEN
    RAISE EXCEPTION 'commission must be between 0 and 100';
  END IF;

  UPDATE vendors
  SET commission_percent = COALESCE(p_commission_percent, commission_percent),
      selling_model      = COALESCE(p_selling_model, selling_model),
      supply_mode        = COALESCE(p_supply_mode, supply_mode),
      return_policy      = COALESCE(p_return_policy, return_policy),
      updated_at         = now()
  WHERE id = p_vendor_id;
END;
$$;


ALTER FUNCTION "public"."admin_set_vendor_terms"("p_vendor_id" bigint, "p_commission_percent" numeric, "p_selling_model" "text", "p_supply_mode" "text", "p_return_policy" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_undelivered_order_ids"() RETURNS TABLE("order_id" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Gated in the database, not merely by which screen calls it. Reads the
  -- table rather than the JWT claim so a stale token cannot grant access.
  IF (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  RETURN QUERY SELECT * FROM public._undelivered_order_ids(NULL);
END;
$$;


ALTER FUNCTION "public"."admin_undelivered_order_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."advance_orders_status"("p_order_ids" bigint[], "p_status" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net'
    AS $$
DECLARE
  v_role  text;
  v_count integer := 0;
  v_url   text;
  v_key   text;
  r       record;
BEGIN
  -- Gate: staff or admin only (SECURITY DEFINER bypasses RLS).
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'unauthorized: staff access required';
  END IF;

  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Push config — read once; if absent, the UPDATE still proceeds silently.
  IF p_status = 'Ready' THEN
    SELECT value INTO v_url FROM app_config WHERE key = 'supabase_url';
    SELECT value INTO v_key FROM app_config WHERE key = 'service_role_key';
  END IF;

  -- Bulk advance — one statement, one transaction. Skips terminal rows
  -- (Cancelled / Failed / Delivered) and no-ops (already at the target).
  FOR r IN
    WITH upd AS (
      UPDATE orders
      SET status = p_status, updated_at = now()
      WHERE id = ANY(p_order_ids)
        AND status NOT IN ('Cancelled', 'Failed', 'Delivered')
        AND status <> p_status
      RETURNING id, user_id
    )
    SELECT id, user_id FROM upd
  LOOP
    v_count := v_count + 1;

    -- Per-order customer push for the 'Ready' milestone — best-effort.
    IF p_status = 'Ready' AND r.user_id IS NOT NULL
       AND v_url IS NOT NULL AND v_key IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url     := v_url || '/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || v_key
          ),
          body    := jsonb_build_object(
            'user_ids',       ARRAY[r.user_id],
            'event_key',      'order.ready',
            'vars',           jsonb_build_object('order_id', r.id),
            'title',          'Order Ready!',
            'body',           'Order #' || r.id || ' is packed and ready for dispatch.',
            'data',           jsonb_build_object(
                                 'screen', 'OrderDetail',
                                 'params', jsonb_build_object('orderId', r.id)
                              ),
            'trigger_source', 'order_status',
            'reference_id',   r.id::text
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[advance_orders_status] push for order % failed: %', r.id, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."advance_orders_status"("p_order_ids" bigint[], "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."alert_cron_failures"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'cron', 'net'
    AS $$
DECLARE
  v_count int;
  v_jobs  text;
  v_url   text;
  v_key   text;
BEGIN
  SELECT count(*), string_agg(DISTINCT j.jobname, ', ')
  INTO v_count, v_jobs
  FROM cron.job_run_details r
  JOIN cron.job j ON j.jobid = r.jobid
  WHERE r.status = 'failed'
    AND r.start_time > now() - interval '70 minutes';

  IF COALESCE(v_count, 0) = 0 THEN
    RETURN;
  END IF;

  SELECT value INTO v_url FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[alert_cron_failures] app_config url/key missing — % cron failure(s) in: %',
      v_count, v_jobs;
    RETURN;
  END IF;

  -- Best-effort: a push problem must never make the health check itself fail.
  BEGIN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'role',           'admin',
        'title',          'Background job failing',
        'body',           v_count || ' cron failure(s) in the last hour: ' || v_jobs,
        -- Deep-links to the System Health surface (audit O1) so the admin
        -- lands on the job-health screen, not the generic home tab.
        'data',           jsonb_build_object('screen', 'JobHealth'),
        'trigger_source', 'cron_health'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[alert_cron_failures] push enqueue failed: %', SQLERRM;
  END;
END;
$$;


ALTER FUNCTION "public"."alert_cron_failures"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."alert_missing_kitchen_pushes"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net'
    AS $$
DECLARE
  v_warn_before CONSTANT INTERVAL := INTERVAL '45 minutes';
  v_cycle    RECORD;
  v_today    DATE;
  v_offset   INTEGER;
  v_target   DATE;
  v_push_at  TIMESTAMPTZ;
  v_deadline TIMESTAMPTZ;
  v_i        INTEGER;
  v_problems TEXT := '';
  v_count    INTEGER := 0;
  v_url      TEXT;
  v_key      TEXT;
BEGIN
  v_today := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;

  FOR v_cycle IN
    SELECT dc.id, dc.cycle_name, dc.kitchen_push_time, dc.cutoff_time, dc.delivery_start
    FROM delivery_cycles dc
    WHERE dc.is_active = TRUE
  LOOP
    v_offset := CASE WHEN v_cycle.cutoff_time > v_cycle.delivery_start THEN 1 ELSE 0 END;

    FOR v_i IN 0..1 LOOP
      v_target   := v_today + v_i;
      v_push_at  := ((v_target - v_offset)::TIMESTAMP + v_cycle.kitchen_push_time)
                      AT TIME ZONE 'Asia/Kolkata';
      v_deadline := (v_target::TIMESTAMP + v_cycle.delivery_start)
                      AT TIME ZONE 'Asia/Kolkata';

      -- Only complain once the push was due AND the delivery is close.
      CONTINUE WHEN NOW() < v_push_at;
      CONTINUE WHEN NOW() < v_deadline - v_warn_before;
      CONTINUE WHEN NOW() >= v_deadline;

      CONTINUE WHEN EXISTS (
        SELECT 1
        FROM kitchen_push_log kpl
        WHERE kpl.cycle_id    = v_cycle.id
          AND kpl.push_date   = v_target
          AND kpl.notified_at IS NOT NULL
      );

      v_count    := v_count + 1;
      v_problems := v_problems
        || CASE WHEN v_problems = '' THEN '' ELSE '; ' END
        || v_cycle.cycle_name || ' → ' || v_target;
    END LOOP;
  END LOOP;

  IF v_count = 0 THEN
    RETURN;
  END IF;

  v_url := _kitchen_get_secret('supabase_url');
  v_key := _kitchen_get_secret('service_role_key');
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[alert_missing_kitchen_pushes] secrets missing — unpushed: %', v_problems;
    RETURN;
  END IF;

  -- Best-effort: an alerting problem must never fail the health check itself.
  BEGIN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'role',           'admin',
        'title',          'Kitchen push missing',
        'body',           v_count || ' cycle(s) with no kitchen summary before delivery: ' || v_problems,
        'data',           jsonb_build_object('screen', 'JobHealth'),
        'trigger_source', 'kitchen_push_health'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[alert_missing_kitchen_pushes] push enqueue failed: %', SQLERRM;
  END;
END;
$$;


ALTER FUNCTION "public"."alert_missing_kitchen_pushes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."alert_undelivered_batch"("p_cycle_id" integer, "p_push_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net'
    AS $$
DECLARE
  v_count      INTEGER;
  v_ids        TEXT;
  v_cycle_name TEXT;
  v_url        TEXT;
  v_key        TEXT;
BEGIN
  -- What was still open in the batch that just stopped being live.
  --
  -- Cancelled and Failed are not "undelivered" — somebody already decided
  -- those. Delivered is the finish line. Everything else in the batch is an
  -- order that was released to the kitchen and never reached the customer,
  -- whatever stage it stalled at.
  SELECT COUNT(*)::INTEGER,
         string_agg('#' || o.id::TEXT, ', ' ORDER BY o.id)
  INTO v_count, v_ids
  FROM orders o
  WHERE o.cycle_id      = p_cycle_id
    AND o.dispatch_date = p_push_date
    AND o.status NOT IN ('Delivered', 'Cancelled', 'Failed');

  IF COALESCE(v_count, 0) = 0 THEN
    RETURN jsonb_build_object('status', 'clean', 'cycle_id', p_cycle_id, 'push_date', p_push_date);
  END IF;

  SELECT cycle_name INTO v_cycle_name FROM delivery_cycles WHERE id = p_cycle_id;

  v_url := _kitchen_get_secret('supabase_url');
  v_key := _kitchen_get_secret('service_role_key');
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[alert_undelivered_batch] secrets missing — % undelivered in cycle % on %',
      v_count, p_cycle_id, p_push_date;
    RETURN jsonb_build_object('status', 'no_secret', 'count', v_count);
  END IF;

  -- event_key so the copy stays admin-editable; title/body are the fallback
  -- send-push uses if the template row is ever deleted.
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'role',      'admin',
      'event_key', 'admin.orders_undelivered',
      'vars',      jsonb_build_object(
        'count',      v_count,
        'cycle_name', COALESCE(v_cycle_name, 'A cycle'),
        'push_date',  p_push_date::TEXT,
        'order_ids',  v_ids
      ),
      'title',     v_count || ' order(s) left undelivered',
      'body',      COALESCE(v_cycle_name, 'A cycle') || ' (' || p_push_date::TEXT
                     || ') closed with ' || v_count || ' order(s) not delivered: ' || v_ids || '.',
      -- Lands the admin ON the Undelivered tab, not merely on the orders
      -- screen: being told three orders were stranded and then dropped onto
      -- today's list means hunting for what you were just told.
      'data',           jsonb_build_object(
                          'screen', 'AdminOrders',
                          'params', jsonb_build_object('view', 'undelivered')
                        ),
      'trigger_source', 'undelivered_batch',
      'reference_id',   p_cycle_id::TEXT || ':' || p_push_date::TEXT
    )
  );

  RETURN jsonb_build_object(
    'status', 'sent', 'count', v_count,
    'cycle_id', p_cycle_id, 'push_date', p_push_date, 'order_ids', v_ids
  );
END;
$$;


ALTER FUNCTION "public"."alert_undelivered_batch"("p_cycle_id" integer, "p_push_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_attendance_correction"("p_request_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_admin     UUID := auth.uid();
  v_staff     UUID;
  v_branch    INTEGER;
  v_status    TEXT;
  v_count     INTEGER := 0;
  v_day       RECORD;
  v_conflict  RECORD;
  v_shift     TEXT;
  v_start_hm  TEXT;
  v_clock_in  TIMESTAMPTZ;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may approve attendance corrections';
  END IF;

  SELECT staff_id, branch_id, status
  INTO v_staff, v_branch, v_status
  FROM public.attendance_correction_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'attendance correction request % not found', p_request_id;
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request % is already %', p_request_id, v_status;
  END IF;

  SELECT d.the_date INTO v_conflict
  FROM public.attendance_correction_days d
  JOIN public.staff_attendance sa
    ON sa.staff_id = v_staff
   AND sa.date = d.the_date
  WHERE d.request_id = p_request_id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'conflict: staff_attendance already exists for %, resolve before approval',
      v_conflict.the_date;
  END IF;

  -- Resolve a default clock-in time from the staff's shift_timing
  -- ("HH:MM-HH:MM"). 09:00 IST fallback when shift_timing is missing
  -- or malformed.
  SELECT shift_timing INTO v_shift FROM public.profiles WHERE id = v_staff;
  v_start_hm := CASE
    WHEN v_shift ~ '^[0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2}$' THEN split_part(v_shift, '-', 1)
    ELSE '09:00'
  END;

  FOR v_day IN
    SELECT * FROM public.attendance_correction_days
    WHERE request_id = p_request_id
    ORDER BY the_date
  LOOP
    v_clock_in := (v_day.the_date::TEXT || ' ' || v_start_hm || ':00 Asia/Kolkata')::TIMESTAMPTZ;

    INSERT INTO public.staff_attendance (
      staff_id, date, clock_in_time, clock_out_time, branch_id
    ) VALUES (
      v_staff, v_day.the_date, v_clock_in, NULL, v_branch
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.attendance_correction_requests
  SET status      = 'approved',
      reviewed_by = v_admin,
      reviewed_at = NOW(),
      updated_at  = NOW()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'days_applied', v_count,
    'approved_by', v_admin,
    'approved_at', NOW()
  );
END;
$_$;


ALTER FUNCTION "public"."approve_attendance_correction"("p_request_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_addresses_to_hub"("p_hub_id" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_poly jsonb;
  v_count int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'not permitted: assign_addresses_to_hub is admin only';
  END IF;

  SELECT polygon_geojson INTO v_poly FROM delivery_hubs WHERE id = p_hub_id;
  IF v_poly IS NULL OR jsonb_typeof(v_poly) <> 'array' OR jsonb_array_length(v_poly) < 3 THEN
    RETURN 0;
  END IF;

  WITH matched AS (
    UPDATE customer_addresses ca
    SET hub_id = p_hub_id
    WHERE (ca.is_serviceable = true OR ca.hub_id = p_hub_id OR ca.hub_id IS NULL)
      AND ca.latitude IS NOT NULL
      AND ca.longitude IS NOT NULL
      AND point_in_polygon(ca.latitude::double precision, ca.longitude::double precision, v_poly)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM matched;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."assign_addresses_to_hub"("p_hub_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_hub_operator"("p_hub_id" bigint, "p_new_user_id" "uuid" DEFAULT NULL::"uuid", "p_old_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- THE GATE. Grants hub-operator powers, so it is admin-only. Reads the
  -- table, not the claim, so a stale token cannot get through.
  IF auth.uid() IS NOT NULL
     AND (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) IS DISTINCT FROM 'admin'
  THEN
    RAISE EXCEPTION 'not permitted: assign_hub_operator is admin only';
  END IF;

  -- 1. Clear old operator's assignment if they're being replaced
  IF p_old_user_id IS NOT NULL
     AND (p_new_user_id IS NULL OR p_old_user_id <> p_new_user_id)
  THEN
    UPDATE profiles
      SET assigned_hub_id = NULL
      WHERE id = p_old_user_id
        AND assigned_hub_id = p_hub_id;
  END IF;

  -- 2. Set new operator's assignment
  IF p_new_user_id IS NOT NULL THEN
    UPDATE profiles
      SET assigned_hub_id = p_hub_id
      WHERE id = p_new_user_id;
  END IF;

  -- 3. Link on the hub side too
  UPDATE delivery_hubs
    SET staff_user_id = p_new_user_id
    WHERE id = p_hub_id;
END;
$$;


ALTER FUNCTION "public"."assign_hub_operator"("p_hub_id" bigint, "p_new_user_id" "uuid", "p_old_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_hub_to_address_ids"("p_hub_id" integer, "p_address_ids" integer[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) IS DISTINCT FROM 'admin'
  THEN
    RAISE EXCEPTION 'not permitted: assign_hub_to_address_ids is admin only';
  END IF;

  UPDATE customer_addresses
  SET    hub_id = p_hub_id
  WHERE  id = ANY(p_address_ids);
END;
$$;


ALTER FUNCTION "public"."assign_hub_to_address_ids"("p_hub_id" integer, "p_address_ids" integer[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_user_id_by_phone"("p_phone" "text") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  SELECT id FROM auth.users WHERE phone = p_phone LIMIT 1;
$$;


ALTER FUNCTION "public"."auth_user_id_by_phone"("p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backfill_dispatch_manifest"("p_start_date" "date", "p_end_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_d             DATE;
  v_total_created INTEGER := 0;
  v_days          INTEGER := 0;
  v_result        JSONB;
  v_per_day       JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;
  IF p_end_date - p_start_date > 31 THEN
    RAISE EXCEPTION 'Range too wide — backfill at most 31 days per call';
  END IF;

  v_d := p_start_date;
  WHILE v_d <= p_end_date LOOP
    -- generate_daily_manifest is idempotent — re-running a date that
    -- already dispatched is a harmless no-op.
    v_result := public.generate_daily_manifest(v_d, NULL);
    v_total_created := v_total_created + COALESCE((v_result->>'orders_created')::int, 0);
    v_per_day := v_per_day || jsonb_build_object(
      'date',           v_d,
      'orders_created', COALESCE((v_result->>'orders_created')::int, 0)
    );
    v_days := v_days + 1;
    v_d := v_d + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'days_processed',       v_days,
    'total_orders_created', v_total_created,
    'per_day',              v_per_day
  );
END;
$$;


ALTER FUNCTION "public"."backfill_dispatch_manifest"("p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."catalog_photo_writable"("p_bucket" "text", "p_key" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_item_id INTEGER;
  v_branch  INTEGER;
  v_vendor  INTEGER;
  v_digits  TEXT;
BEGIN
  -- '{id}.jpg', or 'pending/{id}.jpg' for essentials only. Capped at 9
  -- digits so the cast cannot overflow INTEGER and raise instead of
  -- returning false.
  IF p_key ~ '^[0-9]{1,9}\.jpg$' THEN
    v_digits := split_part(p_key, '.', 1);
  ELSIF p_bucket = 'essentials-photos' AND p_key ~ '^pending/[0-9]{1,9}\.jpg$' THEN
    v_digits := split_part(split_part(p_key, '/', 2), '.', 1);
  ELSE
    RETURN FALSE;
  END IF;
  v_item_id := v_digits::INTEGER;

  -- ── Food menu: admins only, scoped to their branch ──
  IF p_bucket = 'menu-photos' THEN
    SELECT branch_id INTO v_branch
      FROM public.menu_items WHERE id = v_item_id;
    IF NOT FOUND THEN
      RETURN FALSE;
    END IF;
    RETURN public.is_admin() AND public.has_branch_access(v_branch);
  END IF;

  -- ── Essentials: branch admins, plus the owning approved vendor ──
  IF p_bucket = 'essentials-photos' THEN
    SELECT branch_id, vendor_id INTO v_branch, v_vendor
      FROM public.essentials_catalog WHERE id = v_item_id;
    IF NOT FOUND THEN
      RETURN FALSE;
    END IF;

    -- The team can set or take down any picture in their branch, and must be
    -- able to reach the pending key to promote or discard a proposed photo.
    IF public.is_admin() AND public.has_branch_access(v_branch) THEN
      RETURN TRUE;
    END IF;

    RETURN v_vendor IS NOT NULL
       AND EXISTS (
             SELECT 1 FROM public.vendors v
             WHERE v.id = v_vendor
               AND v.owner_user_id = auth.uid()
               AND v.status = 'approved'
           );
  END IF;

  RETURN FALSE;
END;
$_$;


ALTER FUNCTION "public"."catalog_photo_writable"("p_bucket" "text", "p_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."catalog_photo_writable"("p_bucket" "text", "p_key" "text") IS 'May the current user write this catalogue photo object? Applies the same branch test as the catalogue tables, plus vendor ownership for essentials. SECURITY DEFINER because the storage policy that calls it runs as the caller, who can read neither feature_flags nor vendors.';



CREATE OR REPLACE FUNCTION "public"."complete_onboarding_atomic"("p_user_id" "uuid", "p_phone_number" "text", "p_full_name" "text", "p_label" "text", "p_address_line" "text", "p_landmark" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_pincode" "text" DEFAULT NULL::"text", "p_latitude" numeric DEFAULT NULL::numeric, "p_longitude" numeric DEFAULT NULL::numeric, "p_zone_id" integer DEFAULT NULL::integer, "p_hub_id" integer DEFAULT NULL::integer, "p_is_serviceable" boolean DEFAULT false) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_address_id BIGINT;
  v_branch_id  INTEGER;
BEGIN
  -- Defense in depth: only allow the authenticated user to onboard themselves.
  -- The function is SECURITY DEFINER, so without this guard any authenticated
  -- caller could pass an arbitrary UUID and write to another user's rows.
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'unauthorized: p_user_id does not match auth.uid()';
  END IF;

  -- Derive branch from address inputs (single source of truth, no client trust).
  SELECT branch_id INTO v_branch_id FROM delivery_zones WHERE id = p_zone_id;
  IF v_branch_id IS NULL THEN
    SELECT branch_id INTO v_branch_id FROM delivery_hubs WHERE id = p_hub_id;
  END IF;
  v_branch_id := COALESCE(v_branch_id, 1);

  -- Upsert the profile. The on_auth_user_created AFTER INSERT trigger
  -- on auth.users (calling public.handle_new_user) creates a stub
  -- profile row (id + phone_number, no full_name, no branch_id) the
  -- moment OTP signup completes — so by the time this RPC runs, the
  -- row already exists and the ON CONFLICT (id) DO UPDATE branch is
  -- the normal path. The INSERT branch is a defensive fallback for
  -- edge cases (e.g., if the auth trigger ever didn't fire). Both
  -- paths are atomic with the address INSERT below, and both stamp
  -- the derived branch_id.
  INSERT INTO profiles (id, phone_number, full_name, branch_id)
  VALUES (p_user_id, p_phone_number, p_full_name, v_branch_id)
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        branch_id = EXCLUDED.branch_id;

  -- Insert the first delivery address. is_default = TRUE
  -- since this is the user's only address. phone_number is
  -- mirrored from p_phone_number — the customer can change it
  -- per-address later via AddAddressScreen.
  INSERT INTO customer_addresses (
    user_id, label, full_name, phone_number, address_line, landmark, city, pincode,
    latitude, longitude, zone_id, hub_id, is_serviceable, is_default, branch_id
  ) VALUES (
    p_user_id, p_label, p_full_name, p_phone_number, p_address_line, p_landmark, p_city, p_pincode,
    p_latitude, p_longitude, p_zone_id, p_hub_id, p_is_serviceable, TRUE, v_branch_id
  )
  RETURNING id INTO v_address_id;

  RETURN v_address_id;
END;
$$;


ALTER FUNCTION "public"."complete_onboarding_atomic"("p_user_id" "uuid", "p_phone_number" "text", "p_full_name" "text", "p_label" "text", "p_address_line" "text", "p_landmark" "text", "p_city" "text", "p_pincode" "text", "p_latitude" numeric, "p_longitude" numeric, "p_zone_id" integer, "p_hub_id" integer, "p_is_serviceable" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_wallet_topup"("p_razorpay_order_id" "text", "p_razorpay_payment_id" "text") RETURNS TABLE("user_id" "uuid", "amount" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_amount  NUMERIC;
BEGIN
  UPDATE pending_wallet_topups
  SET status       = 'completed',
      completed_at = NOW()
  WHERE razorpay_order_id = p_razorpay_order_id
    AND status = 'pending'
  RETURNING pending_wallet_topups.user_id, pending_wallet_topups.amount
  INTO v_user_id, v_amount;

  IF v_user_id IS NOT NULL THEN
    PERFORM increment_wallet_balance(
      v_user_id,
      v_amount,
      'Wallet topup via Razorpay ' || p_razorpay_payment_id,
      'topup',
      p_razorpay_order_id
    );
  END IF;

  RETURN QUERY SELECT v_user_id, v_amount;
END;
$$;


ALTER FUNCTION "public"."complete_wallet_topup"("p_razorpay_order_id" "text", "p_razorpay_payment_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_custom_plan"("p_cycle_id" integer, "p_items" "jsonb", "p_duration_days" integer, "p_plan_name" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."create_custom_plan"("p_cycle_id" integer, "p_items" "jsonb", "p_duration_days" integer, "p_plan_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_hub_commission_claim"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."create_hub_commission_claim"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_vendor_payout_claim"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."create_vendor_payout_claim"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."credit_vendor_earnings_for_order"("p_order_id" bigint) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."credit_vendor_earnings_for_order"("p_order_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  claims            JSONB;
  v_role            TEXT;
  v_branch_id       BIGINT;
  v_assigned_hub_id BIGINT;
  v_is_super_admin  BOOLEAN;
  v_is_driver       BOOLEAN;
BEGIN
  -- Read the profile row
  SELECT role, branch_id, assigned_hub_id, is_super_admin
    INTO v_role, v_branch_id, v_assigned_hub_id, v_is_super_admin
  FROM public.profiles
  WHERE id = (event->>'user_id')::UUID;

  -- Derive is_driver from the delivery assignment tables. Membership
  -- in either delivery_hubs.driver_user_id or delivery_zones.driver_user_id
  -- gates the customer's "My Deliveries" entry (ProfilePopup) and the
  -- driver advance flow in nextDeliveryStatus.
  v_is_driver := EXISTS (
    SELECT 1 FROM public.delivery_hubs
    WHERE driver_user_id = (event->>'user_id')::UUID
  ) OR EXISTS (
    SELECT 1 FROM public.delivery_zones
    WHERE driver_user_id = (event->>'user_id')::UUID
  );

  claims := event->'claims';
  claims := claims || jsonb_build_object(
    'user_role',       COALESCE(v_role, 'customer'),
    'branch_id',       v_branch_id,
    'assigned_hub_id', v_assigned_hub_id,
    'is_super_admin',  COALESCE(v_is_super_admin, FALSE),
    'is_driver',       v_is_driver
  );

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decrement_wallet_balance_if_sufficient"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text" DEFAULT 'Order payment'::"text", "p_reference_type" "text" DEFAULT NULL::"text", "p_reference_id" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT wallet_balance INTO v_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  INSERT INTO wallet_transactions
    (user_id, transaction_type, amount, description, reference_type, reference_id)
  VALUES
    (p_user_id, 'debit', p_amount, p_description, p_reference_type, p_reference_id);

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."decrement_wallet_balance_if_sufficient"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_reference_type" "text", "p_reference_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."default_branch_id"() RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT id FROM public.branches ORDER BY is_active DESC, id LIMIT 1;
$$;


ALTER FUNCTION "public"."default_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."demote_employee"("target_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
  v_zone_names  TEXT;
  v_hub_names   TEXT;
  v_blockers    TEXT := '';
BEGIN
  -- Admin gate (caller's profiles.role must be 'admin')
  SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  -- Target must currently be staff
  SELECT role INTO v_target_role FROM profiles WHERE id = target_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
  IF v_target_role <> 'staff' THEN
    RAISE EXCEPTION 'Profile is not a staff member';
  END IF;

  -- Driver-tag pre-check: list any zones/hubs that still tag this user.
  SELECT string_agg(zone_name, ', ') INTO v_zone_names
    FROM delivery_zones WHERE driver_user_id = target_id;
  SELECT string_agg(hub_name, ', ') INTO v_hub_names
    FROM delivery_hubs  WHERE driver_user_id = target_id;

  IF v_zone_names IS NOT NULL THEN
    v_blockers := 'Zone(s): ' || v_zone_names;
  END IF;
  IF v_hub_names IS NOT NULL THEN
    IF v_blockers <> '' THEN v_blockers := v_blockers || '; '; END IF;
    v_blockers := v_blockers || 'Hub(s): ' || v_hub_names;
  END IF;

  IF v_blockers <> '' THEN
    RAISE EXCEPTION 'Cannot offboard: assigned as driver to %. Remove via Zone/Hub edit first.', v_blockers;
  END IF;

  -- Demote: role flip + exit_date stamp.
  UPDATE profiles
     SET role = 'customer',
         exit_date = CURRENT_DATE,
         updated_at = NOW()
   WHERE id = target_id;
END;
$$;


ALTER FUNCTION "public"."demote_employee"("target_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_address_branch_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := COALESCE(
      (SELECT branch_id FROM delivery_hubs  WHERE id = NEW.hub_id),
      (SELECT branch_id FROM delivery_zones WHERE id = NEW.zone_id)
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."derive_address_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_driver_code"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_employee_id TEXT;
BEGIN
  IF NEW.driver_user_id IS NULL THEN
    NEW.driver_code := NULL;
    RETURN NEW;
  END IF;

  SELECT employee_id INTO v_employee_id
  FROM public.profiles WHERE id = NEW.driver_user_id;

  IF v_employee_id IS NOT NULL THEN
    NEW.driver_code := v_employee_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."derive_driver_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_profile_branch_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.branch_id IS NULL AND COALESCE(NEW.is_super_admin, FALSE) = FALSE THEN
    NEW.branch_id := COALESCE(
      (SELECT a.branch_id
         FROM public.customer_addresses a
        WHERE a.user_id = NEW.id
          AND a.is_active
          AND a.branch_id IS NOT NULL
        ORDER BY a.is_default DESC, a.id
        LIMIT 1),
      public.default_branch_id()
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."derive_profile_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."elevate_to_staff"("p_user_id" "uuid", "p_full_name" "text", "p_phone_number" "text", "p_designation" "text", "p_joining_date" "date", "p_shift_timing" "text", "p_assigned_hub_id" bigint, "p_monthly_salary" numeric, "p_benefits" "text", "p_joining_bonus" numeric, "p_branch_id" bigint) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_seq         BIGINT;
  v_employee_id TEXT;
  v_existing    TEXT;
  v_existing_id TEXT;
  v_target_role TEXT;
BEGIN
  -- FT-03: designation IS the role discriminator. ADMIN HEAD → admin,
  -- anything else → staff. The guard below only refuses the genuine
  -- demote case (existing admin being overwritten to staff via the
  -- wrong path); admin → admin (e.g. completing onboarding fields on
  -- an already-promoted admin profile) is permitted.
  v_target_role := CASE WHEN p_designation = 'ADMIN HEAD' THEN 'admin' ELSE 'staff' END;

  SELECT role, employee_id INTO v_existing, v_existing_id
    FROM profiles WHERE id = p_user_id;

  IF v_existing = 'admin' AND v_target_role = 'staff' THEN
    RAISE EXCEPTION 'Cannot demote an admin to staff via this path. Change designation away from ADMIN HEAD first.';
  END IF;

  -- Only mint an ID when there isn't one. Calling nextval() unconditionally
  -- burned a number on every correction and left gaps in the series.
  IF v_existing_id IS NULL THEN
    v_seq := nextval('employee_id_seq');
    v_employee_id := '1ST-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT
                            || '-' || LPAD(v_seq::TEXT, 3, '0');
  ELSE
    v_employee_id := v_existing_id;
  END IF;

  INSERT INTO profiles (
    id, role, phone_number, full_name, employee_id, designation,
    joining_date, shift_timing, assigned_hub_id, monthly_salary,
    benefits, branch_id, wallet_balance, loyalty_points
  ) VALUES (
    p_user_id, v_target_role, p_phone_number, p_full_name, v_employee_id, p_designation,
    p_joining_date, p_shift_timing, p_assigned_hub_id, p_monthly_salary,
    NULLIF(p_benefits, ''), p_branch_id, 0, 0
  )
  ON CONFLICT (id) DO UPDATE SET
    role            = v_target_role,
    full_name       = EXCLUDED.full_name,
    employee_id     = COALESCE(profiles.employee_id, EXCLUDED.employee_id),
    designation     = EXCLUDED.designation,
    joining_date    = EXCLUDED.joining_date,
    shift_timing    = EXCLUDED.shift_timing,
    assigned_hub_id = EXCLUDED.assigned_hub_id,
    monthly_salary  = EXCLUDED.monthly_salary,
    benefits        = EXCLUDED.benefits,
    -- COALESCE, not a bare assignment (see item 3 in the header). A NULL
    -- p_branch_id must never blank a branch this profile already has.
    branch_id       = COALESCE(EXCLUDED.branch_id, profiles.branch_id),
    updated_at      = NOW();

  SELECT employee_id INTO v_employee_id FROM profiles WHERE id = p_user_id;

  IF p_monthly_salary > 0 THEN
    INSERT INTO staff_salary (
      staff_id, month, year, base_salary, deductions, bonus, net_salary, is_paid
    ) VALUES (
      p_user_id,
      EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER,
      EXTRACT(YEAR  FROM CURRENT_DATE)::INTEGER,
      p_monthly_salary, 0, p_joining_bonus,
      p_monthly_salary + p_joining_bonus, FALSE
    )
    -- This month may already be settled. Leave it alone; salary is edited on
    -- its own screen, not as a side effect of re-running onboarding.
    ON CONFLICT (staff_id, month, year) DO NOTHING;
  END IF;

  RETURN v_employee_id;
END;
$$;


ALTER FUNCTION "public"."elevate_to_staff"("p_user_id" "uuid", "p_full_name" "text", "p_phone_number" "text", "p_designation" "text", "p_joining_date" "date", "p_shift_timing" "text", "p_assigned_hub_id" bigint, "p_monthly_salary" numeric, "p_benefits" "text", "p_joining_bonus" numeric, "p_branch_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."external_heartbeat"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_url TEXT;
  v_failures BIGINT;
BEGIN
  SELECT value INTO v_url FROM app_config WHERE key = 'healthchecks_ping_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE WARNING '[external_heartbeat] app_config.healthchecks_ping_url is not set';
    RETURN 'not_configured';
  END IF;

  SELECT COUNT(*) INTO v_failures
  FROM cron.job_run_details
  WHERE status = 'failed' AND end_time > NOW() - INTERVAL '10 minutes';

  IF v_failures > 0 THEN
    v_url := v_url || '/fail';
  END IF;

  PERFORM net.http_get(url := v_url, timeout_milliseconds := 8000);
  RETURN CASE WHEN v_failures > 0 THEN 'pinged_fail' ELSE 'pinged_ok' END;
END;
$$;


ALTER FUNCTION "public"."external_heartbeat"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_daily_manifest"("p_target_date" "date" DEFAULT ((CURRENT_DATE + '1 day'::interval))::"date", "p_cycle_id" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net'
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


ALTER FUNCTION "public"."generate_daily_manifest"("p_target_date" "date", "p_cycle_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_staff_batch"("p_branch_id" integer DEFAULT NULL::integer) RETURNS TABLE("cycle_id" integer, "push_date" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT kpl.cycle_id, kpl.push_date
  FROM kitchen_push_log kpl
  JOIN delivery_cycles dc ON dc.id = kpl.cycle_id
  WHERE p_branch_id IS NULL OR dc.branch_id = p_branch_id
  ORDER BY kpl.pushed_at DESC, kpl.id DESC
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_active_staff_batch"("p_branch_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_addresses_for_hub_assignment"("p_hub_id" integer) RETURNS TABLE("id" integer, "latitude" double precision, "longitude" double precision, "user_id" "uuid")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT ca.id, ca.latitude, ca.longitude, ca.user_id
    FROM   customer_addresses ca
    WHERE  ca.is_serviceable = true
       OR  ca.hub_id = p_hub_id                                                                                                                                                                                      
       OR  ca.hub_id IS NULL;
  $$;


ALTER FUNCTION "public"."get_addresses_for_hub_assignment"("p_hub_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_hub_commission_summary"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_hub_commission_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_hub_impact_addresses"("p_hub_id" integer) RETURNS TABLE("id" integer, "user_id" "uuid", "label" "text", "zone_id" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$                                                                                                                                                                                                              
    SELECT ca.id, ca.user_id, ca.label, ca.zone_id          
    FROM   customer_addresses ca
    WHERE  ca.hub_id = p_hub_id
      AND  ca.zone_id IS NULL;
  $$;


ALTER FUNCTION "public"."get_hub_impact_addresses"("p_hub_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_job_health"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'cron'
    AS $$
DECLARE
  v_jobs     jsonb;
  v_manifest jsonb;
  v_push     jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Per cron job: latest run (ordered by runid — monotonic, PK-indexed)
  -- and the failure count inside the last 24h.
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'jobname'), '[]'::jsonb)
  INTO v_jobs
  FROM (
    SELECT jsonb_build_object(
      'jobname',      j.jobname,
      'schedule',     j.schedule,
      'active',       j.active,
      'last_run',     lr.start_time,
      'last_status',  lr.status,
      'last_message', left(lr.return_message, 200),
      'failures_24h', coalesce(f.cnt, 0)
    ) AS x
    FROM cron.job j
    LEFT JOIN LATERAL (
      SELECT status, start_time, return_message
      FROM cron.job_run_details d
      WHERE d.jobid = j.jobid
      ORDER BY d.runid DESC
      LIMIT 1
    ) lr ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt
      FROM cron.job_run_details d
      WHERE d.jobid = j.jobid
        AND d.status = 'failed'
        AND d.start_time > now() - interval '24 hours'
    ) f ON true
  ) sub;

  -- Most recent dispatch manifest runs.
  SELECT coalesce(jsonb_agg(m ORDER BY m->>'ran_at' DESC), '[]'::jsonb)
  INTO v_manifest
  FROM (
    SELECT jsonb_build_object(
      'run_date',       run_date,
      'ran_at',         ran_at,
      'orders_created', orders_created,
      'orders_skipped', orders_skipped,
      'subs_skipped',   subs_skipped,
      'error_detail',   error_detail
    ) AS m
    FROM manifest_run_log
    ORDER BY ran_at DESC
    LIMIT 7
  ) sub;

  -- Push delivery outcomes over the last 24h, keyed by status.
  SELECT coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
  INTO v_push
  FROM (
    SELECT status, count(*) AS cnt
    FROM push_logs
    WHERE sent_at > now() - interval '24 hours'
    GROUP BY status
  ) sub;

  RETURN jsonb_build_object(
    'jobs',       v_jobs,
    'manifest',   v_manifest,
    'push_24h',   v_push,
    'checked_at', now()
  );
END;
$$;


ALTER FUNCTION "public"."get_job_health"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_kitchen_aggregate"("p_cycle_id" bigint, "p_dispatch_date" "date") RETURNS TABLE("item_name" "text", "unit" "text", "total_quantity" double precision, "status" "text", "order_ids" bigint[])
    LANGUAGE "sql" STABLE
    AS $_$
  WITH food_items AS (
    -- Food order_items of non-cancelled orders in this batch.
    SELECT o.id AS order_id, o.status, oi.item_id, oi.item_name,
           oi.quantity, mi.ingredients,
           -- A block carries its own portion and unit; a dish does not.
           (mi.id IS NOT NULL AND mi.is_customer_visible = FALSE) AS is_block,
           COALESCE(mi.base_quantity, 1)                          AS portion,
           mi.unit                                                AS block_unit
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN menu_items mi ON mi.id = oi.item_id
    WHERE o.cycle_id = p_cycle_id
      AND o.dispatch_date = p_dispatch_date
      AND o.status NOT IN ('Delivered', 'Cancelled', 'Failed')
      AND o.order_type = 'food'
      AND (oi.item_type IS NULL OR oi.item_type = 'food')
  ),
  components AS (
    -- A BLOCK ordered directly — from a subscription plan, or a bulk order
    -- buying the part on its own. Its amount is count × its own portion, in
    -- its own unit, so it lands on the SAME prep line as the identical
    -- ingredient arriving inside a dish.
    SELECT order_id, status,
           COALESCE(item_name, 'Item #' || item_id) AS comp_name,
           ((quantity * portion)::text || ' ' || COALESCE(block_unit, '')) AS token,
           1 AS mult
    FROM food_items
    WHERE is_block AND (ingredients IS NULL OR btrim(ingredients) = '')
    UNION ALL
    -- No ingredients and not a block → fallback unchanged: the meal itself,
    -- token = its qty, no unit.
    SELECT order_id, status,
           COALESCE(item_name, 'Item #' || item_id) AS comp_name,
           quantity::text AS token,
           1 AS mult
    FROM food_items
    WHERE NOT is_block AND (ingredients IS NULL OR btrim(ingredients) = '')
    UNION ALL
    -- Ingredients defined → one component per ';'-chunk, "name:token".
    SELECT fi.order_id, fi.status, c.comp_name, c.token, fi.quantity
    FROM food_items fi
    CROSS JOIN LATERAL (
      SELECT btrim(split_part(chunk, ':', 1)) AS comp_name,
             COALESCE(NULLIF(btrim(split_part(chunk, ':', 2)), ''), '1') AS token
      FROM regexp_split_to_table(fi.ingredients, ';') AS chunk
      WHERE btrim(chunk) <> ''
    ) c
    WHERE fi.ingredients IS NOT NULL AND btrim(fi.ingredients) <> ''
      AND c.comp_name <> ''
  ),
  valued AS (
    SELECT order_id, status, comp_name,
           regexp_match(token, '^([0-9]*\.?[0-9]+)\s*(.*)$') AS m,
           mult
    FROM components
  )
  SELECT
    comp_name AS item_name,
    CASE WHEN m IS NULL THEN '' ELSE btrim(m[2]) END AS unit,
    SUM((CASE WHEN m IS NULL THEN 1 ELSE m[1]::numeric END) * mult)::double precision
      AS total_quantity,
    status,
    array_agg(DISTINCT order_id ORDER BY order_id) AS order_ids
  FROM valued
  GROUP BY comp_name, (CASE WHEN m IS NULL THEN '' ELSE btrim(m[2]) END), status
  ORDER BY
    array_position(
      ARRAY['Pending','Confirmed','Preparing','Ready','Packed',
            'Dispatched','Received at Hub','On the Way','Delivered'],
      status
    ),
    comp_name;
$_$;


ALTER FUNCTION "public"."get_kitchen_aggregate"("p_cycle_id" bigint, "p_dispatch_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_server_time"() RETURNS timestamp with time zone
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN NOW();
END;
$$;


ALTER FUNCTION "public"."get_server_time"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_first_order_referral_bonus"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_referrer_id   UUID;
  v_referral_id   BIGINT;
  v_already_done  BOOLEAN;
  v_is_active     BOOLEAN;
  v_credit        NUMERIC;
  v_points        INTEGER;
  v_order_count   INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (NEW.status IN ('Paid', 'Confirmed') AND OLD.status NOT IN ('Paid', 'Confirmed')) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('Paid', 'Confirmed') THEN
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    SELECT referred_by INTO v_referrer_id
    FROM public.profiles WHERE id = NEW.user_id;
    IF v_referrer_id IS NULL THEN RETURN NEW; END IF;

    SELECT id, first_order_reward_given INTO v_referral_id, v_already_done
    FROM public.referrals
    WHERE referee_id = NEW.user_id AND referrer_id = v_referrer_id;
    IF v_referral_id IS NULL OR v_already_done THEN RETURN NEW; END IF;

    SELECT
      COALESCE(is_active, FALSE),
      COALESCE(referrer_first_order_credit, 30),
      COALESCE(referrer_first_order_points, 100)
    INTO v_is_active, v_credit, v_points
    FROM public.referral_settings
    LIMIT 1;
    IF NOT v_is_active THEN RETURN NEW; END IF;

    SELECT COUNT(*)::INTEGER INTO v_order_count
    FROM public.orders
    WHERE user_id = NEW.user_id
      AND status NOT IN ('Cancelled', 'Failed', 'Pending');
    IF v_order_count <> 1 THEN RETURN NEW; END IF;

    IF v_credit > 0 THEN
      PERFORM public.increment_wallet_balance(
        v_referrer_id, v_credit,
        'Referral bonus — your friend placed their first order',
        'referral', v_referral_id::text
      );
    END IF;
    IF v_points > 0 THEN
      PERFORM public.increment_loyalty_points(v_referrer_id, v_points);
    END IF;

    UPDATE public.referrals
    SET status = 'first_order_done',
        first_order_reward_given = TRUE,
        reward_given = TRUE
    WHERE id = v_referral_id;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[handle_first_order_referral_bonus] order_id=% user_id=% error: %',
      NEW.id, NEW.user_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_first_order_referral_bonus"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$                         
  BEGIN                                                                                                                                                 
    INSERT INTO public.profiles (id, role, phone_number)                                                                                                
    VALUES (NEW.id, 'customer', NEW.phone)                                                                                                              
    ON CONFLICT (id) DO NOTHING;                           
    RETURN NEW;                                                                                                                                         
  END;                                   
  $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_branch_access"("row_branch_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT
    public.is_super_admin()
    OR NOT COALESCE(
         (SELECT flag_value FROM public.feature_flags
            WHERE flag_key = 'branch_management_active'),
         FALSE)
    OR row_branch_id = public.jwt_branch_id();
$$;


ALTER FUNCTION "public"."has_branch_access"("row_branch_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_loyalty_points"("p_user_id" "uuid", "p_points" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE profiles SET loyalty_points = loyalty_points + p_points WHERE id = p_user_id;
  INSERT INTO loyalty_redemptions (user_id, points, type, description)
  VALUES (p_user_id, p_points, 'earned', 'Referral reward');
END;
$$;


ALTER FUNCTION "public"."increment_loyalty_points"("p_user_id" "uuid", "p_points" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text" DEFAULT ''::"text", "p_reference_type" "text" DEFAULT NULL::"text", "p_reference_id" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id;

  INSERT INTO wallet_transactions
    (user_id, transaction_type, amount, description, reference_type, reference_id)
  VALUES
    (p_user_id, 'credit', p_amount, p_description, p_reference_type, p_reference_id);
END;
$$;


ALTER FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_reference_type" "text", "p_reference_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT public.jwt_user_role() = '"admin"' OR public.jwt_user_role() = 'admin';
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_staff_or_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT public.jwt_user_role() IN ('"admin"', 'admin', '"staff"', 'staff');
$$;


ALTER FUNCTION "public"."is_staff_or_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'is_super_admin', '')::BOOLEAN,
    (SELECT is_super_admin FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."jwt_branch_id"() RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  SELECT NULLIF((auth.jwt() ->> 'branch_id'), '')::INTEGER;
$$;


ALTER FUNCTION "public"."jwt_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."jwt_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'user_role')::TEXT,
    (auth.jwt() -> 'app_metadata' ->> 'user_role'),
    'customer'
  );
$$;


ALTER FUNCTION "public"."jwt_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_order_failed"("p_razorpay_order_id" "text", "p_reason" "text" DEFAULT 'payment_failed'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE orders
  SET status = 'Failed',
      notes  = COALESCE(notes || ' | ', '') || p_reason
  WHERE razorpay_order_id = p_razorpay_order_id
    AND status = 'Pending';
END;
$$;


ALTER FUNCTION "public"."mark_order_failed"("p_razorpay_order_id" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_order_paid"("p_razorpay_order_id" "text", "p_razorpay_payment_id" "text") RETURNS TABLE("order_id" bigint, "user_id" "uuid", "total_amount" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- BF-32a: Webhook + confirm-order paths now write the same status
  -- literal so downstream surfaces (statusColor, statusVariant, Packing
  -- advance) don't have to handle two values for the same state.
  RETURN QUERY
  UPDATE orders
  SET status = 'Confirmed',
      razorpay_payment_id = p_razorpay_payment_id,
      paid_at = NOW()
  WHERE razorpay_order_id = p_razorpay_order_id
    AND status = 'Pending'
  RETURNING orders.id, orders.user_id, orders.total_amount;
END;
$$;


ALTER FUNCTION "public"."mark_order_paid"("p_razorpay_order_id" "text", "p_razorpay_payment_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."menu_block_usage"("p_name" "text") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT count(DISTINCT mi.id)::INTEGER
  FROM public.menu_items mi,
       LATERAL regexp_split_to_table(COALESCE(mi.ingredients, ''), ';') AS chunk
  WHERE mi.is_customer_visible
    AND btrim(chunk) <> ''
    AND lower(btrim(split_part(chunk, ':', 1))) = lower(btrim(p_name));
$$;


ALTER FUNCTION "public"."menu_block_usage"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mirror_staff_request_to_supply_items"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_item JSONB;
BEGIN
  IF NEW.status = 'Pending' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items)
    LOOP
      PERFORM public.add_or_merge_supply_order_item(
        v_item ->> 'name',
        (v_item ->> 'qty')::INTEGER,
        NEW.request_type,
        NEW.id,
        NEW.submitted_by,
        NEW.branch_id
      );
    END LOOP;

    UPDATE public.staff_order_requests
    SET status = 'Approved',
        approved_by = COALESCE(approved_by, submitted_by)
    WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."mirror_staff_request_to_supply_items"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."vendors" (
    "id" bigint NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "branch_id" integer,
    "business_name" "text",
    "contact_phone" "text",
    "gst_number" "text",
    "fssai_number" "text",
    "selling_model" "text" DEFAULT 'own_brand'::"text" NOT NULL,
    "supply_mode" "text" DEFAULT 'they_drop'::"text" NOT NULL,
    "commission_percent" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'invited'::"text" NOT NULL,
    "return_policy" "text",
    "terms_accepted_at" timestamp with time zone,
    "invited_by" "uuid",
    "submitted_at" timestamp with time zone,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "admin_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vendors_commission_percent_check" CHECK ((("commission_percent" >= (0)::numeric) AND ("commission_percent" <= (100)::numeric))),
    CONSTRAINT "vendors_selling_model_check" CHECK (("selling_model" = ANY (ARRAY['own_brand'::"text", 'house_brand'::"text"]))),
    CONSTRAINT "vendors_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'submitted'::"text", 'approved'::"text", 'suspended'::"text", 'rejected'::"text"]))),
    CONSTRAINT "vendors_supply_mode_check" CHECK (("supply_mode" = ANY (ARRAY['at_hub'::"text", 'we_collect'::"text", 'they_drop'::"text"])))
);


ALTER TABLE "public"."vendors" OWNER TO "postgres";


COMMENT ON COLUMN "public"."vendors"."selling_model" IS 'own_brand = marketplace, vendor is seller of record, commission. house_brand = 1stOne is seller of record under its own GSTIN/FSSAI and BUYS at an agreed rate.';



COMMENT ON COLUMN "public"."vendors"."supply_mode" IS 'How goods reach the delivery point: at_hub (already there), we_collect, they_drop. Procurement attribute only — the last mile is always 1stOne''s.';



CREATE OR REPLACE FUNCTION "public"."my_approved_vendor"() RETURNS "public"."vendors"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT * FROM public.vendors
  WHERE owner_user_id = auth.uid() AND status = 'approved'
  LIMIT 1;
$$;


ALTER FUNCTION "public"."my_approved_vendor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_order_states"() RETURNS TABLE("order_id" bigint, "state" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT o.id::BIGINT,
         CASE
           WHEN u.order_id IS NOT NULL THEN 'undelivered'
           WHEN o.status = ANY (ARRAY['Confirmed', 'Preparing', 'Ready', 'Packed',
                                      'Dispatched', 'Received at Hub', 'On the Way'])
             THEN 'live'
           ELSE 'awaiting_payment'
         END
  FROM orders o
  LEFT JOIN public._undelivered_order_ids(auth.uid()) u ON u.order_id = o.id
  WHERE o.user_id = auth.uid()
    AND o.status NOT IN ('Delivered', 'Cancelled', 'Failed')
    AND o.cycle_id IS NOT NULL;
$$;


ALTER FUNCTION "public"."my_order_states"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_admins_listing_submitted"("p_vendor_name" "text", "p_count" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'supabase_url';
    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL; v_key := NULL;
  END;

  IF v_url IS NULL OR v_key IS NULL THEN
    SELECT value INTO v_url FROM public.app_config WHERE key = 'supabase_url';
    SELECT value INTO v_key FROM public.app_config WHERE key = 'service_role_key';
  END IF;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[notify_admins_listing_submitted] no url/key — push skipped';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'role',      'admin',
      'event_key', 'admin.vendor_listing_submitted',
      'vars',      jsonb_build_object('vendor', p_vendor_name, 'count', p_count),
      'title',     'Vendor listing to review',
      'body',      p_vendor_name || ' sent ' || p_count ||
                   CASE WHEN p_count = 1 THEN ' item' ELSE ' items' END || ' for approval.',
      'data',      jsonb_build_object('screen', 'AdminVendorListings'),
      'trigger_source', 'vendor_listing'
    )
  );
EXCEPTION WHEN OTHERS THEN
  -- A failed push must not undo an accepted submission.
  RAISE WARNING '[notify_admins_listing_submitted] %', SQLERRM;
END;
$$;


ALTER FUNCTION "public"."notify_admins_listing_submitted"("p_vendor_name" "text", "p_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_attendance_regularization"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net'
    AS $$
DECLARE
  v_today       DATE;
  v_target      DATE;
  v_url         TEXT;
  v_key         TEXT;
  v_staff_count INTEGER;
BEGIN
  -- IST, not the server's date. Between 00:00 and 05:30 IST a UTC date is
  -- still yesterday, which on the 1st of a month would fire this a day late
  -- — the one day it must not.
  v_today  := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_target := (date_trunc('month', v_today) + INTERVAL '1 month' - INTERVAL '2 days')::DATE;

  IF v_today <> v_target THEN
    RETURN;
  END IF;

  -- Nothing to say to nobody. Also keeps the log quiet on a branch that has
  -- not hired yet.
  SELECT COUNT(*) INTO v_staff_count FROM public.profiles WHERE role = 'staff';
  IF v_staff_count = 0 THEN
    RAISE NOTICE '[notify_attendance_regularization] no staff — skipped';
    RETURN;
  END IF;

  v_url := public._kitchen_get_secret('supabase_url');
  v_key := public._kitchen_get_secret('service_role_key');
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[notify_attendance_regularization] no url/key — push skipped';
    RETURN;
  END IF;

  -- role='staff' with no branch_id: the message is the same in every branch,
  -- and scoping it would mean one call per branch for no difference in copy.
  -- event_key makes send-push prefer the editable template; the title/body
  -- here are the fallback for a deleted template row, not the source.
  BEGIN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'role',           'staff',
        'event_key',      'staff.attendance_regularization',
        'title',          'Check your attendance',
        'body',           'The month closes tomorrow. Open Attendance and send a correction for any day you forgot to clock in or out.',
        'data',           jsonb_build_object('screen', 'Attendance'),
        'trigger_source', 'attendance_reminder'
      )
    );
    RAISE NOTICE '[notify_attendance_regularization] sent to % staff', v_staff_count;
  EXCEPTION WHEN OTHERS THEN
    -- A failed push must not fail the job: a red cron run pulls the owner in
    -- via alert_cron_failures for something that is only a missed reminder.
    RAISE WARNING '[notify_attendance_regularization] push enqueue failed: %', SQLERRM;
  END;
END;
$$;


ALTER FUNCTION "public"."notify_attendance_regularization"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."orders_status_no_regress"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  -- Mirrors ORDER_STATUS_FLOW in src/utils/orderStatus.ts. The two must stay
  -- in step: that array is what the offline replay guard slices, and this is
  -- what the database enforces. Cancelled and Failed are off-flow by design.
  v_flow  TEXT[] := ARRAY['Pending','Confirmed','Preparing','Ready','Packed',
                          'Dispatched','Received at Hub','On the Way','Delivered'];
  v_old   INTEGER;
  v_new   INTEGER;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Server-side callers and admins are the authority; see the header.
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('Cancelled', 'Failed') THEN
    RAISE EXCEPTION
      'Order % is % and cannot be reopened. Ask an admin if this is wrong.',
      OLD.id, OLD.status;
  END IF;

  -- Moving TO a terminal status is always allowed (a driver marking a failed
  -- delivery); only coming back out of one is not.
  IF NEW.status IN ('Cancelled', 'Failed') THEN
    RETURN NEW;
  END IF;

  v_old := array_position(v_flow, OLD.status);
  v_new := array_position(v_flow, NEW.status);

  -- A status outside the known flow (legacy 'Paid') is left alone rather than
  -- guessed at — refusing on an unknown value would be a worse failure than
  -- allowing it.
  IF v_old IS NULL OR v_new IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_new < v_old THEN
    RAISE EXCEPTION
      'Order % cannot go from % back to %.', OLD.id, OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."orders_status_no_regress"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_order_atomic"("p_user_id" "uuid", "p_status" "text", "p_order_type" "text", "p_delivery_method" "text", "p_hub_id" bigint, "p_payment_method" "text", "p_razorpay_order_id" "text", "p_delivery_address_id" bigint, "p_notes" "text", "p_branch_id" bigint, "p_groups" "jsonb") RETURNS TABLE("new_order_id" bigint, "new_group_id" "uuid", "new_cycle_id" bigint, "new_dispatch_date" "date")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."place_order_atomic"("p_user_id" "uuid", "p_status" "text", "p_order_type" "text", "p_delivery_method" "text", "p_hub_id" bigint, "p_payment_method" "text", "p_razorpay_order_id" "text", "p_delivery_address_id" bigint, "p_notes" "text", "p_branch_id" bigint, "p_groups" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."plan_discount_percent"("p_days" integer) RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(MAX(percent), 0)
  FROM subscription_discount_slabs
  WHERE is_active
    AND p_days >= min_days
    AND p_days <= max_days;
$$;


ALTER FUNCTION "public"."plan_discount_percent"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."point_in_polygon"("p_lat" double precision, "p_lng" double precision, "p_poly" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  n int;
  i int;
  j int;
  inside boolean := false;
  lat_i double precision; lng_i double precision;
  lat_j double precision; lng_j double precision;
BEGIN
  IF p_poly IS NULL OR jsonb_typeof(p_poly) <> 'array' THEN
    RETURN false;
  END IF;
  n := jsonb_array_length(p_poly);
  IF n < 3 THEN
    RETURN false;
  END IF;

  j := n - 1;
  FOR i IN 0 .. n - 1 LOOP
    lat_i := (p_poly -> i ->> 'lat')::double precision;
    lng_i := (p_poly -> i ->> 'lng')::double precision;
    lat_j := (p_poly -> j ->> 'lat')::double precision;
    lng_j := (p_poly -> j ->> 'lng')::double precision;
    IF ((lng_i > p_lng) <> (lng_j > p_lng))
       AND (p_lat < (lat_j - lat_i) * (p_lng - lng_i) / (lng_j - lng_i) + lat_i) THEN
      inside := NOT inside;
    END IF;
    j := i;
  END LOOP;

  RETURN inside;
END;
$$;


ALTER FUNCTION "public"."point_in_polygon"("p_lat" double precision, "p_lng" double precision, "p_poly" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."print_supply_batch_atomic"("p_item_ids" integer[], "p_branch_id" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_snapshot JSONB;
  v_count INTEGER;
  v_batch_id BIGINT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can print a supply batch';
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Order list is empty.';
  END IF;

  -- Snapshot from the LIVE rows (unbatched only) — server-authoritative.
  SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'category', category)),
         COUNT(*)
  INTO v_snapshot, v_count
  FROM supply_order_items
  WHERE id = ANY(p_item_ids) AND batch_id IS NULL;

  IF COALESCE(v_count, 0) = 0 THEN
    RAISE EXCEPTION 'Nothing to print — the selected items are already batched.';
  END IF;

  INSERT INTO supply_batches (printed_at, printed_by, items_snapshot, note, branch_id)
  VALUES (NOW(), auth.uid(), v_snapshot, NULL, p_branch_id)
  RETURNING id INTO v_batch_id;

  UPDATE supply_order_items
  SET batch_id = v_batch_id
  WHERE id = ANY(p_item_ids) AND batch_id IS NULL;

  RETURN jsonb_build_object('batch_id', v_batch_id, 'items', v_count);
END;
$$;


ALTER FUNCTION "public"."print_supply_batch_atomic"("p_item_ids" integer[], "p_branch_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prune_operational_logs"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_push BIGINT;
  v_manifest BIGINT;
  v_kitchen BIGINT;
  v_cron BIGINT;
BEGIN
  -- Push delivery audit: 90 days.
  DELETE FROM push_logs WHERE sent_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_push = ROW_COUNT;

  -- Subscription dispatch runs: 180 days (longer — money-adjacent audit).
  DELETE FROM manifest_run_log WHERE ran_at < NOW() - INTERVAL '180 days';
  GET DIAGNOSTICS v_manifest = ROW_COUNT;

  -- Kitchen pushes: 90 days. Safe — the staff "active batch" reads only
  -- the LATEST row, and the dedupe key only matters within a single day.
  DELETE FROM kitchen_push_log WHERE pushed_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_kitchen = ROW_COUNT;

  -- pg_cron's own run history: 7 days (the per-minute tick floods this;
  -- Job Health only reads the last run + a 24h failure window).
  DELETE FROM cron.job_run_details WHERE end_time < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_cron = ROW_COUNT;

  RETURN format('pruned push_logs=%s manifest_run_log=%s kitchen_push_log=%s job_run_details=%s',
                v_push, v_manifest, v_kitchen, v_cron);
END;
$$;


ALTER FUNCTION "public"."prune_operational_logs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."push_kitchen_summary"("p_cycle_id" integer, "p_target_date" "date" DEFAULT CURRENT_DATE) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net'
    AS $$
DECLARE
  v_cycle        RECORD;
  v_orders_count INTEGER := 0;
  v_summary      TEXT    := '';
  v_payload      JSONB;
  v_url          TEXT;
  v_key          TEXT;
  v_req_id       BIGINT;
  v_branch_id    INTEGER;
  v_log_id       BIGINT;
  v_prev         RECORD;   -- ADDED: the batch this push is about to replace
  v_is_new       BOOLEAN;  -- ADDED: did this call create a new claim, or retry one?
BEGIN
  SELECT id, cycle_name, branch_id
  INTO v_cycle
  FROM delivery_cycles
  WHERE id = p_cycle_id AND is_active = TRUE;

  IF v_cycle IS NULL THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'cycle not found or inactive');
  END IF;

  v_branch_id := v_cycle.branch_id;

  -- ADDED: read the currently-active batch BEFORE claiming, because the
  -- claim below is what makes this push the active one. Same ordering
  -- get_active_staff_batch uses — INCLUDING the id tiebreak, so the two
  -- cannot disagree about which batch is live. Two rows sharing a pushed_at
  -- is not hypothetical: now() is frozen for a transaction, so any two
  -- pushes made in one (a manual backfill, a tick handling two cycles)
  -- record the same instant, and `ORDER BY pushed_at DESC LIMIT 1` alone
  -- then picks one arbitrarily.
  SELECT kpl.cycle_id, kpl.push_date
  INTO v_prev
  FROM kitchen_push_log kpl
  JOIN delivery_cycles dc ON dc.id = kpl.cycle_id
  WHERE dc.branch_id IS NOT DISTINCT FROM v_branch_id
  ORDER BY kpl.pushed_at DESC, kpl.id DESC
  LIMIT 1;

  -- Count orders for this cycle + date (includes both ad-hoc and
  -- subscription-driven). Orders that should actually reach staff: Confirmed
  -- / Preparing. Pending (awaiting the razorpay webhook) is intentionally
  -- excluded. Food AND essentials — this is the batch release for both, and
  -- narrowing it to food would make an essentials-only cycle count zero,
  -- short-circuit to 'no_orders', and tell nobody there was packing to do.
  SELECT COUNT(*)::INTEGER
  INTO v_orders_count
  FROM orders o
  WHERE o.cycle_id       = p_cycle_id
    AND o.dispatch_date  = p_target_date
    AND o.status         IN ('Confirmed', 'Preparing');

  -- Build a textual summary: "Item A x 12, Item B x 5" — ordered by qty desc
  SELECT string_agg(line, ', ' ORDER BY total_qty DESC)
  INTO v_summary
  FROM (
    SELECT
      oi.item_name,
      SUM(oi.quantity)::INTEGER AS total_qty,
      (oi.item_name || ' x ' || SUM(oi.quantity)::TEXT) AS line
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.cycle_id      = p_cycle_id
      AND o.dispatch_date = p_target_date
      AND o.status        IN ('Confirmed', 'Preparing')
    GROUP BY oi.item_name
  ) agg;

  -- CLAIM the cycle+date. UNIQUE (cycle_id, push_date) still enforces one
  -- push per delivery date, but we re-claim a row whose notified_at is NULL:
  -- that row represents an attempt that never actually reached anyone.
  INSERT INTO kitchen_push_log (cycle_id, push_date, orders_count, items_summary, status, attempts)
  VALUES (p_cycle_id, p_target_date, v_orders_count, COALESCE(v_summary, ''), 'pending', 1)
  ON CONFLICT (cycle_id, push_date) DO UPDATE
    SET orders_count  = EXCLUDED.orders_count,
        items_summary = EXCLUDED.items_summary,
        status        = 'pending',
        attempts      = kitchen_push_log.attempts + 1
    WHERE kitchen_push_log.notified_at IS NULL
  -- ADDED: xmax = 0 is true only for a row this statement INSERTED. On the
  -- DO UPDATE path it is the id of the updating transaction, i.e. non-zero.
  -- That distinguishes a genuinely new batch from a retry of an unconfirmed
  -- one exactly, rather than inferring it by comparing v_prev to the
  -- arguments — an inference that also depended on the ordering above being
  -- unambiguous.
  RETURNING id, (xmax = 0) INTO v_log_id, v_is_new;

  -- No row returned → a CONFIRMED push already exists for this cycle+date.
  IF v_log_id IS NULL THEN
    RETURN jsonb_build_object('status', 'duplicate', 'cycle_id', p_cycle_id, 'target_date', p_target_date);
  END IF;

  -- ADDED: the boards have just flipped. Report whatever the outgoing batch
  -- still had open.
  --
  -- Only on a NEW claim. A retry of an unconfirmed claim is not a flip — the
  -- boards are already showing this batch — and alerting there would report
  -- the incoming batch as abandoned every time a push was retried.
  --
  -- Wrapped, and deliberately so. This is a notification hanging off the
  -- kitchen's critical path; if it throws, the kitchen loses its summary.
  IF v_is_new
     AND v_prev.cycle_id IS NOT NULL
     AND NOT (v_prev.cycle_id = p_cycle_id AND v_prev.push_date = p_target_date) THEN
    BEGIN
      PERFORM public.alert_undelivered_batch(v_prev.cycle_id, v_prev.push_date);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[push_kitchen_summary] undelivered alert failed for cycle % on %: %',
        v_prev.cycle_id, v_prev.push_date, SQLERRM;
    END;
  END IF;

  -- Short-circuit: no orders. Confirmed rather than left pending — the cutoff
  -- has passed, so no further orders can land on this date.
  IF v_orders_count = 0 THEN
    UPDATE kitchen_push_log
    SET status = 'no_orders', notified_at = NOW()
    WHERE id = v_log_id;
    RETURN jsonb_build_object('status', 'no_orders', 'cycle_id', p_cycle_id, 'target_date', p_target_date);
  END IF;

  -- "Order summary", not "Kitchen order summary" — carried over verbatim from
  -- kitchen_push_title_2026_08.sql. This push releases the batch to Kitchen
  -- AND Packing, and an essentials-only cycle has nothing to cook. There is
  -- no event_key, so the string is not editable from Notification Manager.
  v_payload := jsonb_build_object(
    'role',       'staff',
    'branch_id',  v_branch_id,
    'title',      'Order summary — ' || v_cycle.cycle_name,
    'body',       v_orders_count || ' orders ready to start. ' || COALESCE(v_summary, ''),
    'data',       jsonb_build_object('screen', 'StaffDashboard', 'cycle_id', p_cycle_id)
  );

  v_url := _kitchen_get_secret('supabase_url');
  v_key := _kitchen_get_secret('service_role_key');

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[push_kitchen_summary] Missing supabase_url or service_role_key (vault + app_config)';
    UPDATE kitchen_push_log SET status = 'no_secret' WHERE id = v_log_id;
    RETURN jsonb_build_object('status', 'no_secret', 'cycle_id', p_cycle_id);
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := v_payload
  ) INTO v_req_id;

  UPDATE kitchen_push_log
  SET http_request_id = v_req_id,
      status          = 'dispatched',
      notified_at     = NOW()
  WHERE id = v_log_id;

  RETURN jsonb_build_object(
    'status',         'dispatched',
    'cycle_id',       p_cycle_id,
    'target_date',    p_target_date,
    'orders_count',   v_orders_count,
    'request_id',     v_req_id
  );
END;
$$;


ALTER FUNCTION "public"."push_kitchen_summary"("p_cycle_id" integer, "p_target_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redeem_loyalty_points"("p_points" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_have           integer;
  v_redemption_id  bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'Enter a positive number of points to redeem';
  END IF;

  SELECT loyalty_points INTO v_have
  FROM profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF v_have IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  IF v_have < p_points THEN
    RAISE EXCEPTION 'Not enough points — you have %', v_have;
  END IF;

  UPDATE profiles
  SET loyalty_points = loyalty_points - p_points,
      wallet_balance = wallet_balance + p_points
  WHERE id = v_user_id;

  INSERT INTO loyalty_redemptions (user_id, points, type, description)
  VALUES (v_user_id, p_points, 'redeemed',
          'Redeemed ' || p_points || ' points for wallet credit')
  RETURNING id INTO v_redemption_id;

  INSERT INTO wallet_transactions
    (user_id, amount, transaction_type, description, reference_type, reference_id)
  VALUES
    (v_user_id, p_points, 'credit',
     'Loyalty points redeemed (' || p_points || ' pts)',
     'loyalty_redemption', v_redemption_id::text);

  RETURN jsonb_build_object(
    'redeemed_points',          p_points,
    'wallet_credited',          p_points,
    'loyalty_points_remaining', v_have - p_points
  );
END;
$$;


ALTER FUNCTION "public"."redeem_loyalty_points"("p_points" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_attendance_correction"("p_request_id" bigint, "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin  UUID := auth.uid();
  v_status TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may reject attendance corrections';
  END IF;

  SELECT status INTO v_status
  FROM public.attendance_correction_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'attendance correction request % not found', p_request_id;
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request % is already %', p_request_id, v_status;
  END IF;

  UPDATE public.attendance_correction_requests
  SET status        = 'rejected',
      reviewed_by   = v_admin,
      reviewed_at   = NOW(),
      reviewer_note = p_note,
      updated_at    = NOW()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('request_id', p_request_id, 'rejected_by', v_admin);
END;
$$;


ALTER FUNCTION "public"."reject_attendance_correction"("p_request_id" bigint, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_address_on_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_res  RECORD;
  v_hubs BOOLEAN;
BEGIN
  -- Trusted callers keep what they wrote: service-role and cron (no uid),
  -- and staff/admin, who legitimately override routing
  -- (assign_addresses_to_hub, fixing a misrouted address).
  IF auth.uid() IS NULL OR public.is_staff_or_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
    -- No pin to resolve from. Previously this returned NEW untouched, which
    -- is what let a customer declare their own routing. Now: an update keeps
    -- whatever was already resolved, and an insert gets nothing.
    IF TG_OP = 'UPDATE' THEN
      NEW.zone_id        := OLD.zone_id;
      NEW.hub_id         := OLD.hub_id;
      NEW.is_serviceable := OLD.is_serviceable;
      NEW.branch_id      := OLD.branch_id;
    ELSE
      NEW.zone_id        := NULL;
      NEW.hub_id         := NULL;
      NEW.is_serviceable := FALSE;
      NEW.branch_id      := NULL;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_res
  FROM public.resolve_address_serviceability(
    NEW.latitude::double precision,
    NEW.longitude::double precision
  );

  v_hubs := COALESCE(
    (SELECT flag_value FROM public.feature_flags WHERE flag_key = 'hub_delivery_active'),
    FALSE
  );

  NEW.zone_id        := v_res.zone_id;
  NEW.hub_id         := CASE WHEN v_hubs THEN v_res.hub_id ELSE NULL END;
  NEW.is_serviceable := v_res.is_serviceable;
  NEW.branch_id      := COALESCE(
    (SELECT branch_id FROM public.delivery_hubs  WHERE id = NEW.hub_id),
    (SELECT branch_id FROM public.delivery_zones WHERE id = NEW.zone_id)
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."resolve_address_on_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_address_serviceability"("p_lat" double precision, "p_lng" double precision) RETURNS TABLE("result" "text", "is_serviceable" boolean, "zone_id" integer, "zone_name" "text", "hub_id" integer, "hub_name" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_zone_id    int;
  v_zone_name  text;
  v_hub_id     int;
  v_hub_name   text;
  v_ext_hub_id int;
  v_config_count int;
BEGIN
  SELECT z.id, z.zone_name INTO v_zone_id, v_zone_name
  FROM delivery_zones z
  WHERE z.is_active
    AND jsonb_typeof(z.polygon_geojson) = 'array'
    AND jsonb_array_length(z.polygon_geojson) >= 3
    AND point_in_polygon(p_lat, p_lng, z.polygon_geojson)
  ORDER BY z.id
  LIMIT 1;

  SELECT h.id, h.hub_name INTO v_hub_id, v_hub_name
  FROM delivery_hubs h
  WHERE h.is_active
    AND jsonb_typeof(h.polygon_geojson) = 'array'
    AND jsonb_array_length(h.polygon_geojson) >= 3
    AND point_in_polygon(p_lat, p_lng, h.polygon_geojson)
  ORDER BY h.id
  LIMIT 1;

  SELECT h.id INTO v_ext_hub_id
  FROM delivery_hubs h
  WHERE h.is_active AND h.extends_coverage
    AND jsonb_typeof(h.polygon_geojson) = 'array'
    AND jsonb_array_length(h.polygon_geojson) >= 3
    AND point_in_polygon(p_lat, p_lng, h.polygon_geojson)
  ORDER BY h.id
  LIMIT 1;

  -- Is any polygon configured at all? (active zones + active extending hubs)
  SELECT
    (SELECT count(*) FROM delivery_zones z
       WHERE z.is_active AND jsonb_typeof(z.polygon_geojson) = 'array'
         AND jsonb_array_length(z.polygon_geojson) >= 3)
  + (SELECT count(*) FROM delivery_hubs h
       WHERE h.is_active AND h.extends_coverage AND jsonb_typeof(h.polygon_geojson) = 'array'
         AND jsonb_array_length(h.polygon_geojson) >= 3)
  INTO v_config_count;

  zone_id        := v_zone_id;
  zone_name      := v_zone_name;
  hub_id         := v_hub_id;
  hub_name       := v_hub_name;
  is_serviceable := (v_zone_id IS NOT NULL) OR (v_ext_hub_id IS NOT NULL);

  IF is_serviceable THEN
    result := 'serviceable';
  ELSIF v_config_count > 0 THEN
    result := 'not_serviceable';
  ELSE
    result := 'unknown';
  END IF;

  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."resolve_address_serviceability"("p_lat" double precision, "p_lng" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_attendance_correction_branch_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT branch_id INTO NEW.branch_id
    FROM profiles WHERE id = NEW.staff_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_attendance_correction_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_cancelled_day_branch_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT branch_id INTO NEW.branch_id
    FROM user_subscriptions
    WHERE id = NEW.subscription_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_cancelled_day_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_default_address"("p_address_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- The target address must belong to the caller and be active.
  IF NOT EXISTS (
    SELECT 1 FROM customer_addresses
    WHERE id = p_address_id AND user_id = v_user AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'address % not found for this user', p_address_id;
  END IF;

  -- Clear the existing default, then set the new one — one transaction.
  UPDATE customer_addresses
  SET is_default = FALSE
  WHERE user_id = v_user AND is_default = TRUE;

  UPDATE customer_addresses
  SET is_default = TRUE
  WHERE id = p_address_id AND user_id = v_user;
END;
$$;


ALTER FUNCTION "public"."set_default_address"("p_address_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_employee_designation"("target_id" "uuid", "new_designation" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_role        TEXT;
  v_caller_branch      INTEGER;
  v_is_super_admin     BOOLEAN;
  v_target_designation TEXT;
  v_target_role        TEXT;
  v_crossing_admin     BOOLEAN;
  v_new_role           TEXT;
BEGIN
  -- Caller gate: must be admin. FT-05: super-admin marker is the
  -- explicit profiles.is_super_admin column; the legacy
  -- "v_caller_branch IS NULL" convention is no longer authoritative.
  SELECT role, branch_id, is_super_admin INTO v_caller_role, v_caller_branch, v_is_super_admin
    FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  v_is_super_admin := COALESCE(v_is_super_admin, FALSE);

  -- Target must exist and be a staff or admin profile (not a customer).
  SELECT designation, role INTO v_target_designation, v_target_role
    FROM public.profiles WHERE id = target_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;
  IF v_target_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Target must be staff or admin (current role: %)', v_target_role;
  END IF;

  -- Super-admin gate when changing TO or FROM 'ADMIN HEAD'.
  v_crossing_admin :=
    (new_designation = 'ADMIN HEAD' AND v_target_designation IS DISTINCT FROM 'ADMIN HEAD')
    OR
    (v_target_designation = 'ADMIN HEAD' AND new_designation IS DISTINCT FROM 'ADMIN HEAD');
  IF v_crossing_admin AND NOT v_is_super_admin THEN
    RAISE EXCEPTION 'Only super-admin can change designation to or from ADMIN HEAD';
  END IF;

  -- Atomic designation + role flip.
  IF new_designation = 'ADMIN HEAD' THEN
    v_new_role := 'admin';
  ELSE
    v_new_role := 'staff';
  END IF;

  UPDATE public.profiles
     SET designation = new_designation,
         role        = v_new_role,
         updated_at  = NOW()
   WHERE id = target_id;
END;
$$;


ALTER FUNCTION "public"."set_employee_designation"("target_id" "uuid", "new_designation" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_expense_claim_branch_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT branch_id INTO NEW.branch_id
    FROM profiles
    WHERE id = NEW.staff_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_expense_claim_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_staff_order_request_branch_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT branch_id INTO NEW.branch_id
    FROM profiles
    WHERE id = NEW.submitted_by;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_staff_order_request_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_profile_phone_on_auth_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone AND NEW.phone IS NOT NULL THEN
    UPDATE public.profiles
      SET phone_number = NEW.phone,
          updated_at   = NOW()
      WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_profile_phone_on_auth_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tag_wallet_debit_to_order"("p_user_id" "uuid", "p_order_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Tag the most recent untagged 'Order payment' debit for this user that
  -- landed within the last 5 minutes. The filter on reference_id IS NULL +
  -- description='Order payment' makes the update idempotent: a re-tag
  -- attempt is a no-op once the reference has been set.
  UPDATE wallet_transactions
  SET reference_type = 'order',
      reference_id   = p_order_id::text,
      description    = 'Order payment for #' || p_order_id::text
  WHERE id = (
    SELECT id FROM wallet_transactions
    WHERE user_id = p_user_id
      AND transaction_type = 'debit'
      AND description = 'Order payment'
      AND reference_id IS NULL
      AND created_at > NOW() - INTERVAL '5 minutes'
    ORDER BY id DESC
    LIMIT 1
  );
END;
$$;


ALTER FUNCTION "public"."tag_wallet_debit_to_order"("p_user_id" "uuid", "p_order_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_credit_vendor_earnings"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."trg_credit_vendor_earnings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_vendor_payout_paid"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."trg_vendor_payout_paid"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_kitchen_cutoff_pushes"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cycle    RECORD;
  v_today    DATE;
  v_offset   INTEGER;
  v_target   DATE;
  v_push_at  TIMESTAMPTZ;
  v_deadline TIMESTAMPTZ;
  v_i        INTEGER;
BEGIN
  v_today := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;

  FOR v_cycle IN
    SELECT dc.id, dc.kitchen_push_time, dc.cutoff_time, dc.delivery_start
    FROM delivery_cycles dc
    WHERE dc.is_active = TRUE
  LOOP
    v_offset := CASE WHEN v_cycle.cutoff_time > v_cycle.delivery_start THEN 1 ELSE 0 END;

    FOR v_i IN -1..1 LOOP
      v_target   := v_today + v_i;
      v_push_at  := ((v_target - v_offset)::TIMESTAMP + v_cycle.kitchen_push_time)
                      AT TIME ZONE 'Asia/Kolkata';
      v_deadline := (v_target::TIMESTAMP + v_cycle.delivery_start)
                      AT TIME ZONE 'Asia/Kolkata';

      CONTINUE WHEN NOW() < v_push_at OR NOW() >= v_deadline;

      CONTINUE WHEN EXISTS (
        SELECT 1
        FROM kitchen_push_log kpl
        WHERE kpl.cycle_id    = v_cycle.id
          AND kpl.push_date   = v_target
          AND kpl.notified_at IS NOT NULL
      );

      BEGIN
        PERFORM generate_daily_manifest(
          p_target_date => v_target,
          p_cycle_id    => v_cycle.id
        );
        PERFORM push_kitchen_summary(v_cycle.id, v_target);
      EXCEPTION WHEN OTHERS THEN
        -- This handler runs AFTER the savepoint rollback, so anything it
        -- writes survives — which is exactly why the audit row has to be
        -- written HERE and not inside generate_daily_manifest, whose own
        -- row is discarded along with the rest of the failed call.
        --
        -- Best-effort: a logging failure must not abort the remaining
        -- cycles, which is the whole point of this isolation block.
        BEGIN
          INSERT INTO manifest_run_log
            (run_date, orders_created, orders_skipped, subs_skipped, error_detail)
          VALUES
            (v_target, 0, 0, 0,
             format('cycle %s failed: %s', v_cycle.id, SQLERRM));
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[trigger_kitchen_cutoff_pushes] could not record failure: %', SQLERRM;
        END;

        RAISE WARNING '[trigger_kitchen_cutoff_pushes] cycle % target % failed: %',
          v_cycle.id, v_target, SQLERRM;
      END;
    END LOOP;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."trigger_kitchen_cutoff_pushes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_employee_profile"("target_id" "uuid", "updates" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_role    TEXT;
  v_caller_branch  INTEGER;
  v_target_branch  INTEGER;
  v_is_super_admin BOOLEAN;
BEGIN
  -- Caller gate. FT-05: super-admin marker is the explicit
  -- profiles.is_super_admin column; the legacy "v_caller_branch IS NULL"
  -- convention is no longer authoritative.
  SELECT role, branch_id, is_super_admin INTO v_caller_role, v_caller_branch, v_is_super_admin
    FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  v_is_super_admin := COALESCE(v_is_super_admin, FALSE);

  -- Branch scope: branch admin can only touch profiles in their branch.
  SELECT branch_id INTO v_target_branch
    FROM public.profiles WHERE id = target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;
  IF NOT v_is_super_admin AND v_target_branch IS DISTINCT FROM v_caller_branch THEN
    RAISE EXCEPTION 'Target outside your branch';
  END IF;

  UPDATE public.profiles SET
    full_name       = CASE WHEN updates ? 'full_name'       THEN updates->>'full_name'                              ELSE full_name END,
    joining_date    = CASE WHEN updates ? 'joining_date'    THEN NULLIF(updates->>'joining_date',    '')::DATE      ELSE joining_date END,
    shift_timing    = CASE WHEN updates ? 'shift_timing'    THEN updates->>'shift_timing'                           ELSE shift_timing END,
    monthly_salary  = CASE WHEN updates ? 'monthly_salary'  THEN NULLIF(updates->>'monthly_salary',  '')::NUMERIC   ELSE monthly_salary END,
    benefits        = CASE WHEN updates ? 'benefits'        THEN updates->>'benefits'                               ELSE benefits END,
    assigned_hub_id = CASE WHEN updates ? 'assigned_hub_id' THEN NULLIF(updates->>'assigned_hub_id', '')::INTEGER   ELSE assigned_hub_id END,
    updated_at      = NOW()
   WHERE id = target_id;
END;
$$;


ALTER FUNCTION "public"."update_employee_profile"("target_id" "uuid", "updates" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_create_draft_listing"("p_name" "text", "p_price" numeric, "p_unit" "text", "p_cycle_id" integer, "p_description" "text" DEFAULT NULL::"text", "p_daily_cap" integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_vendor public.vendors;
  v_id     INTEGER;
BEGIN
  v_vendor := public.my_approved_vendor();
  IF v_vendor.id IS NULL THEN
    RAISE EXCEPTION 'Only an approved vendor can add a listing.';
  END IF;
  IF COALESCE(TRIM(p_name), '') = '' THEN
    RAISE EXCEPTION 'Enter an item name.';
  END IF;
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'Enter a selling price.';
  END IF;
  -- Only a cycle that can actually render on the Essentials page. Filing an
  -- item under a non-essentials cycle had it fetched and silently dropped.
  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_cycles
    WHERE id = p_cycle_id AND is_essentials AND is_active
  ) THEN
    RAISE EXCEPTION 'Choose a delivery time for this item.';
  END IF;

  INSERT INTO public.essentials_catalog
    (name, price, unit, cycle_id, description, daily_cap,
     vendor_id, branch_id, is_active, sort_order, listing_status)
  VALUES
    (TRIM(p_name), p_price, COALESCE(NULLIF(TRIM(p_unit), ''), 'unit'),
     p_cycle_id, NULLIF(TRIM(p_description), ''), p_daily_cap,
     v_vendor.id, v_vendor.branch_id,
     -- Inactive until approved, so an approval is never also a surprise
     -- go-live for an item the vendor has not finished preparing.
     FALSE, 0, 'draft')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."vendor_create_draft_listing"("p_name" "text", "p_price" numeric, "p_unit" "text", "p_cycle_id" integer, "p_description" "text", "p_daily_cap" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_ids_for_address"("p_address_id" bigint) RETURNS TABLE("vendor_id" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT v.id
  FROM vendors v
  JOIN vendor_zones vz ON vz.vendor_id = v.id
  JOIN customer_addresses ca ON ca.id = p_address_id
  WHERE v.status = 'approved'
    AND (
      (vz.zone_id IS NOT NULL AND vz.zone_id = ca.zone_id)
      OR (vz.hub_id IS NOT NULL AND vz.hub_id = ca.hub_id)
    );
$$;


ALTER FUNCTION "public"."vendor_ids_for_address"("p_address_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_ids_visible_to_me"() RETURNS TABLE("vendor_id" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT DISTINCT v.id
  FROM vendors v
  JOIN vendor_zones vz ON vz.vendor_id = v.id
  JOIN customer_addresses ca ON ca.user_id = auth.uid() AND ca.is_active
  WHERE v.status = 'approved'
    AND (
      (vz.zone_id IS NOT NULL AND vz.zone_id = ca.zone_id)
      OR (vz.hub_id IS NOT NULL AND vz.hub_id = ca.hub_id)
    );
$$;


ALTER FUNCTION "public"."vendor_ids_visible_to_me"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."vendor_ids_visible_to_me"() IS 'Vendor IDs the current user may buy from, based on their active addresses. SECURITY DEFINER because the RLS policy that calls it runs as the customer, who cannot read vendors or vendor_zones. Returns IDs only — never vendor business details.';



CREATE OR REPLACE FUNCTION "public"."vendor_listing_edit_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Only vendor-owned rows that are already live are gated.
  IF NEW.vendor_id IS NULL OR COALESCE(OLD.listing_status, 'approved') <> 'approved' THEN
    RETURN NEW;
  END IF;

  -- The team edits freely — that IS the approval path
  -- (admin_review_listing_change writes through here), as does anything
  -- running server-side with no user attached.
  IF auth.uid() IS NULL OR public.is_staff_or_admin() THEN
    RETURN NEW;
  END IF;

  -- A vendor touching their own live listing: keep availability, revert the
  -- rest. Silently, and on purpose — the vendor's route is "propose a
  -- change", and My Store never offers a direct edit of a live row, so
  -- anything arriving here is a hand-made REST call rather than a person
  -- being surprised by a rejection.
  NEW.name        := OLD.name;
  NEW.price       := OLD.price;
  NEW.unit        := OLD.unit;
  NEW.cycle_id    := OLD.cycle_id;
  NEW.description := OLD.description;
  NEW.image_path  := OLD.image_path;
  NEW.image_updated_at := OLD.image_updated_at;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."vendor_listing_edit_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_mark_order_ready"("p_order_id" bigint, "p_ready" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_vendor_id BIGINT;
BEGIN
  SELECT id INTO v_vendor_id FROM vendors WHERE owner_user_id = auth.uid();
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Not a vendor';
  END IF;

  -- Only for an order that actually contains this vendor's goods.
  IF NOT EXISTS (
    SELECT 1 FROM order_items oi
    JOIN essentials_catalog ec ON ec.id = oi.item_id
    WHERE oi.order_id = p_order_id AND ec.vendor_id = v_vendor_id
  ) THEN
    RAISE EXCEPTION 'That order does not contain your items';
  END IF;

  INSERT INTO vendor_order_fulfilment (vendor_id, order_id, ready_at, ready_by)
  VALUES (v_vendor_id, p_order_id,
          CASE WHEN p_ready THEN now() ELSE NULL END,
          CASE WHEN p_ready THEN auth.uid() ELSE NULL END)
  ON CONFLICT (vendor_id, order_id) DO UPDATE
    SET ready_at = CASE WHEN p_ready THEN now() ELSE NULL END,
        ready_by = CASE WHEN p_ready THEN auth.uid() ELSE NULL END;
END;
$$;


ALTER FUNCTION "public"."vendor_mark_order_ready"("p_order_id" bigint, "p_ready" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_orders"() RETURNS TABLE("order_id" bigint, "dispatch_date" "date", "cycle_name" "text", "status" "text", "items" "jsonb", "ready_at" timestamp with time zone, "customer_name" "text", "customer_phone" "text", "cancellable_until" timestamp with time zone, "bucket" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_vendor_id     BIGINT;
  v_supply_mode   TEXT;
  v_show_customer BOOLEAN;
  v_window        INTERVAL;
  -- How far back history reaches. Bounded so a long-running vendor does not
  -- pull years of rows onto a phone; vendor_earnings is the money record.
  v_history_days  CONSTANT INTEGER := 60;
BEGIN
  SELECT id, supply_mode INTO v_vendor_id, v_supply_mode
  FROM vendors WHERE owner_user_id = auth.uid();
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Not a vendor';
  END IF;

  -- Only a vendor whose goods already sit at the hub plausibly hands them
  -- over, so only they get customer detail.
  v_show_customer := (v_supply_mode = 'at_hub');

  SELECT make_interval(mins => (COALESCE(cancellation_window_hours, 0) * 60)::int)
    INTO v_window
  FROM store_config LIMIT 1;

  RETURN QUERY
  WITH
  -- The active batch per branch — the same row get_active_staff_batch hands
  -- the staff screens, computed for every branch at once. NULL branch_id is
  -- its own group, which is what DISTINCT ON does with nulls and what a
  -- single-branch install actually has.
  --
  -- The id tiebreak matches get_active_staff_batch exactly, and has to: if
  -- the two ordered differently the vendor's "now" could be a different batch
  -- from the one the kitchen is looking at. pushed_at alone is a partial
  -- order because now() is frozen for a transaction, so two pushes made in
  -- one carry the same instant.
  latest_push AS (
    SELECT DISTINCT ON (dc.branch_id)
           dc.branch_id,
           kpl.cycle_id,
           kpl.push_date
    FROM kitchen_push_log kpl
    JOIN delivery_cycles dc ON dc.id = kpl.cycle_id
    ORDER BY dc.branch_id, kpl.pushed_at DESC, kpl.id DESC
  )
  SELECT o.id::BIGINT,
         o.dispatch_date,
         -- The ESSENTIALS label, not the food one: a vendor sells essentials,
         -- and the customer buying from them sees "Morning", not "Breakfast".
         COALESCE(NULLIF(btrim(dc.essentials_label), ''), dc.cycle_name)::TEXT,
         o.status::TEXT,
         jsonb_agg(jsonb_build_object(
           'item_name', oi.item_name,
           'quantity',  oi.quantity
         ) ORDER BY oi.item_name),
         f.ready_at,
         (CASE WHEN v_show_customer THEN ca.full_name ELSE NULL END)::TEXT,
         (CASE WHEN v_show_customer THEN ca.phone_number ELSE NULL END)::TEXT,
         -- Past 'Preparing' the order is out of cancel-order's reach entirely,
         -- so there is no deadline left to report. The previous version also
         -- listed 'Pending' and 'Paid' here: Pending never reaches this
         -- function (filtered below) and 'Paid' was dropped from the orders
         -- status constraint in May 2026, so both were unreachable.
         (CASE
            WHEN o.status NOT IN ('Confirmed', 'Preparing') THEN NULL
            ELSE LEAST(grp.first_created + v_window, grp.first_cutoff)
          END),
         (CASE
            -- Finished is finished, whatever batch it belonged to.
            WHEN o.status IN ('Delivered', 'Cancelled', 'Failed') THEN 'history'
            -- In the batch currently on every other board.
            WHEN lp.cycle_id = o.cycle_id AND lp.push_date = o.dispatch_date THEN 'now'
            -- Its cycle+date was pushed at some point, and the batch has since
            -- moved on — so it left the live boards unfinished.
            WHEN EXISTS (
              SELECT 1 FROM kitchen_push_log k
              WHERE k.cycle_id = o.cycle_id AND k.push_date = o.dispatch_date
            ) THEN 'history'
            -- Never released yet: the vendor's lead time.
            ELSE 'upcoming'
          END)::TEXT
  FROM orders o
  JOIN order_items oi        ON oi.order_id = o.id
  JOIN essentials_catalog ec ON ec.id = oi.item_id
  LEFT JOIN delivery_cycles dc    ON dc.id = o.cycle_id
  LEFT JOIN customer_addresses ca ON ca.id = o.delivery_address_id
  LEFT JOIN vendor_order_fulfilment f
         ON f.order_id = o.id AND f.vendor_id = v_vendor_id
  -- The order's branch decides which batch is "active" for it.
  LEFT JOIN latest_push lp ON lp.branch_id IS NOT DISTINCT FROM dc.branch_id
  -- The deadline belongs to the whole order group, not this one row.
  LEFT JOIN LATERAL (
    SELECT MIN(g.created_at) AS first_created,
           MIN(((g.dispatch_date
                  - (CASE WHEN gc.cutoff_time > gc.delivery_start THEN 1 ELSE 0 END))::timestamp
                + gc.cutoff_time) AT TIME ZONE 'Asia/Kolkata') AS first_cutoff
    FROM orders g
    LEFT JOIN delivery_cycles gc ON gc.id = g.cycle_id
    WHERE g.order_group_id = o.order_group_id
  ) grp ON TRUE
  WHERE ec.vendor_id = v_vendor_id
    AND oi.item_type = 'essential'
    -- Widened from `>= today`: history needs the days behind us. Bounded so
    -- the list cannot grow without limit.
    AND o.dispatch_date >= ((now() AT TIME ZONE 'Asia/Kolkata')::date - v_history_days)
    -- Unpaid is not a sale. Excluded from every bucket, as before.
    AND o.status <> 'Pending'
  GROUP BY o.id, o.dispatch_date, dc.essentials_label, dc.cycle_name, dc.branch_id,
           o.status, o.cycle_id, f.ready_at, ca.full_name, ca.phone_number,
           grp.first_created, grp.first_cutoff, lp.cycle_id, lp.push_date
  ORDER BY o.dispatch_date, o.id;
END;
$$;


ALTER FUNCTION "public"."vendor_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_propose_listing_change"("p_item_id" integer, "p_proposed" "jsonb", "p_photo_pending" boolean DEFAULT false) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_vendor public.vendors;
  v_row    public.essentials_catalog;
  v_id     BIGINT;
BEGIN
  v_vendor := public.my_approved_vendor();
  IF v_vendor.id IS NULL THEN
    RAISE EXCEPTION 'Only an approved vendor can change a listing.';
  END IF;

  SELECT * INTO v_row FROM public.essentials_catalog
   WHERE id = p_item_id AND vendor_id = v_vendor.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That item is not yours.';
  END IF;

  -- A listing that has never been approved is edited in place — there is no
  -- live version to protect, so making the vendor wait would be pointless.
  IF v_row.listing_status <> 'approved' THEN
    RAISE EXCEPTION 'This item is not live yet — edit it directly.';
  END IF;

  IF p_proposed IS NULL OR p_proposed = '{}'::JSONB THEN
    IF NOT p_photo_pending THEN
      RAISE EXCEPTION 'Nothing changed.';
    END IF;
  END IF;

  -- Replace rather than queue. The unique index enforces this too; deleting
  -- first is what makes a re-edit succeed instead of hitting the constraint.
  DELETE FROM public.vendor_listing_changes
   WHERE item_id = p_item_id AND status = 'pending';

  INSERT INTO public.vendor_listing_changes
    (item_id, vendor_id, proposed, photo_pending)
  VALUES
    (p_item_id, v_vendor.id, COALESCE(p_proposed, '{}'::JSONB), p_photo_pending)
  RETURNING id INTO v_id;

  PERFORM public.notify_admins_listing_submitted(
    COALESCE(v_vendor.business_name, 'A vendor'), 1);

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."vendor_propose_listing_change"("p_item_id" integer, "p_proposed" "jsonb", "p_photo_pending" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_submit_listings"("p_item_ids" integer[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_vendor  public.vendors;
  v_missing TEXT;
  v_count   INTEGER;
BEGIN
  v_vendor := public.my_approved_vendor();
  IF v_vendor.id IS NULL THEN
    RAISE EXCEPTION 'Only an approved vendor can send items for approval.';
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Choose at least one item to send.';
  END IF;

  -- Name the items that are missing a picture rather than refusing the whole
  -- batch anonymously — with five items in flight "add a photo" is useless.
  SELECT string_agg(name, ', ' ORDER BY name) INTO v_missing
  FROM public.essentials_catalog
  WHERE id = ANY(p_item_ids)
    AND vendor_id = v_vendor.id
    AND image_path IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Add a photo before sending: %', v_missing;
  END IF;

  UPDATE public.essentials_catalog
     SET listing_status   = 'pending',
         submitted_at     = NOW(),
         rejection_reason = NULL
   WHERE id = ANY(p_item_ids)
     AND vendor_id = v_vendor.id
     AND listing_status IN ('draft', 'rejected');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nothing to send — those items are already with us or approved.';
  END IF;

  PERFORM public.notify_admins_listing_submitted(
    COALESCE(v_vendor.business_name, 'A vendor'), v_count);

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."vendor_submit_listings"("p_item_ids" integer[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_submit_registration"("p_business_name" "text", "p_contact_phone" "text" DEFAULT NULL::"text", "p_gst_number" "text" DEFAULT NULL::"text", "p_fssai_number" "text" DEFAULT NULL::"text", "p_return_policy" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id     BIGINT;
  v_status TEXT;
BEGIN
  SELECT id, status INTO v_id, v_status
  FROM vendors WHERE owner_user_id = auth.uid() FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'You are not registered as a vendor.';
  END IF;
  IF v_status <> 'invited' THEN
    RAISE EXCEPTION 'Your details have already been sent for verification.';
  END IF;
  IF COALESCE(btrim(p_business_name), '') = '' THEN
    RAISE EXCEPTION 'Business name is required.';
  END IF;

  UPDATE vendors
  SET business_name     = btrim(p_business_name),
      contact_phone     = NULLIF(btrim(COALESCE(p_contact_phone, '')), ''),
      gst_number        = NULLIF(btrim(COALESCE(p_gst_number, '')), ''),
      fssai_number      = NULLIF(btrim(COALESCE(p_fssai_number, '')), ''),
      return_policy     = NULLIF(btrim(COALESCE(p_return_policy, '')), ''),
      terms_accepted_at = now(),
      submitted_at      = now(),
      status            = 'submitted',
      updated_at        = now()
  WHERE id = v_id;

  RETURN jsonb_build_object('vendor_id', v_id, 'status', 'submitted');
END;
$$;


ALTER FUNCTION "public"."vendor_submit_registration"("p_business_name" "text", "p_contact_phone" "text", "p_gst_number" "text", "p_fssai_number" "text", "p_return_policy" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_supply_list"() RETURNS TABLE("dispatch_date" "date", "cycle_id" bigint, "cycle_name" "text", "item_id" bigint, "item_name" "text", "total_qty" bigint, "order_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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
         o.cycle_id::BIGINT,
         dc.cycle_name::TEXT,
         oi.item_id::BIGINT,
         oi.item_name::TEXT,
         SUM(oi.quantity)::BIGINT,
         COUNT(DISTINCT o.id)::BIGINT
  FROM orders o
  JOIN order_items oi        ON oi.order_id = o.id
  JOIN essentials_catalog ec ON ec.id = oi.item_id
  LEFT JOIN delivery_cycles dc ON dc.id = o.cycle_id
  WHERE ec.vendor_id = v_vendor_id
    AND oi.item_type = 'essential'
    AND o.dispatch_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
    AND o.status NOT IN ('Pending', 'Cancelled', 'Failed')
  GROUP BY o.dispatch_date, o.cycle_id, dc.cycle_name, oi.item_id, oi.item_name
  ORDER BY o.dispatch_date, dc.cycle_name NULLS LAST, oi.item_name;
END;
$$;


ALTER FUNCTION "public"."vendor_supply_list"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vendor_used_quantities"("p_item_ids" bigint[], "p_dispatch_date" "date") RETURNS TABLE("item_id" bigint, "used_qty" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT oi.item_id::BIGINT, COALESCE(SUM(oi.quantity), 0)::BIGINT
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.item_id = ANY(p_item_ids)
    AND oi.item_type = 'essential'
    AND o.dispatch_date = p_dispatch_date
    AND o.status NOT IN ('Cancelled', 'Failed')
  GROUP BY oi.item_id;
$$;


ALTER FUNCTION "public"."vendor_used_quantities"("p_item_ids" bigint[], "p_dispatch_date" "date") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_notes" (
    "id" integer NOT NULL,
    "target_tab" "text",
    "note_text" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "branch_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "admin_notes_target_tab_check" CHECK (("target_tab" = ANY (ARRAY['kitchen'::"text", 'packing'::"text", 'delivery'::"text", 'all'::"text", 'hub'::"text"])))
);


ALTER TABLE "public"."admin_notes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."admin_notes_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."admin_notes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."admin_notes_id_seq" OWNED BY "public"."admin_notes"."id";



CREATE TABLE IF NOT EXISTS "public"."app_config" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "public"."app_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_feedback" (
    "id" integer NOT NULL,
    "user_id" "uuid",
    "order_id" integer,
    "rating" integer,
    "comments" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "app_feedback_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."app_feedback" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."app_feedback_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."app_feedback_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."app_feedback_id_seq" OWNED BY "public"."app_feedback"."id";



CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "id" integer DEFAULT 1 NOT NULL,
    "login_bg_url" "text" DEFAULT 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1080&q=80'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "landing_hero_url" "text",
    "staff_designations" "jsonb",
    "staff_benefits" "jsonb",
    CONSTRAINT "single_row" CHECK (("id" = 1))
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_correction_days" (
    "id" bigint NOT NULL,
    "request_id" bigint NOT NULL,
    "the_date" "date" NOT NULL
);


ALTER TABLE "public"."attendance_correction_days" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."attendance_correction_days_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."attendance_correction_days_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."attendance_correction_days_id_seq" OWNED BY "public"."attendance_correction_days"."id";



CREATE TABLE IF NOT EXISTS "public"."attendance_correction_requests" (
    "id" bigint NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "reviewer_note" "text",
    "branch_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attendance_correction_requests_reason_check" CHECK (("length"(TRIM(BOTH FROM "reason")) > 0)),
    CONSTRAINT "attendance_correction_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."attendance_correction_requests" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."attendance_correction_requests_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."attendance_correction_requests_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."attendance_correction_requests_id_seq" OWNED BY "public"."attendance_correction_requests"."id";



CREATE TABLE IF NOT EXISTS "public"."banners" (
    "id" integer NOT NULL,
    "banner_type" "text",
    "image_url" "text",
    "text_content" "text",
    "is_live" boolean DEFAULT false,
    "branch_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "banners_banner_type_check" CHECK (("banner_type" = ANY (ARRAY['image'::"text", 'text'::"text"])))
);


ALTER TABLE "public"."banners" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."banners_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."banners_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."banners_id_seq" OWNED BY "public"."banners"."id";



CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" integer NOT NULL,
    "branch_name" "text" NOT NULL,
    "address" "text",
    "phone" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "essentials_enabled" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."branches_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."branches_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."branches_id_seq" OWNED BY "public"."branches"."id";



CREATE TABLE IF NOT EXISTS "public"."business_expenses" (
    "id" integer NOT NULL,
    "category" "text" NOT NULL,
    "description" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "expense_date" "date" NOT NULL,
    "vendor" "text",
    "is_paid" boolean DEFAULT false,
    "paid_at" timestamp with time zone,
    "recorded_by" "uuid",
    "branch_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."business_expenses" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."business_expenses_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."business_expenses_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."business_expenses_id_seq" OWNED BY "public"."business_expenses"."id";



CREATE TABLE IF NOT EXISTS "public"."cancelled_subscription_days" (
    "id" integer NOT NULL,
    "subscription_id" integer,
    "cancelled_date" "date" NOT NULL,
    "cycle_id" integer,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "branch_id" integer
);


ALTER TABLE "public"."cancelled_subscription_days" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cancelled_subscription_days_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cancelled_subscription_days_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cancelled_subscription_days_id_seq" OWNED BY "public"."cancelled_subscription_days"."id";



CREATE TABLE IF NOT EXISTS "public"."customer_addresses" (
    "id" integer NOT NULL,
    "user_id" "uuid",
    "label" "text" DEFAULT 'Home'::"text",
    "full_name" "text" NOT NULL,
    "address_line" "text" NOT NULL,
    "landmark" "text",
    "city" "text",
    "pincode" "text",
    "latitude" numeric(10,7),
    "longitude" numeric(10,7),
    "is_default" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "zone_id" integer,
    "is_serviceable" boolean DEFAULT false NOT NULL,
    "hub_id" integer,
    "hub_impact_notified_at" timestamp with time zone,
    "branch_id" integer,
    "phone_number" "text"
);


ALTER TABLE "public"."customer_addresses" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."customer_addresses_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."customer_addresses_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."customer_addresses_id_seq" OWNED BY "public"."customer_addresses"."id";



CREATE TABLE IF NOT EXISTS "public"."delivery_cycles" (
    "id" integer NOT NULL,
    "cycle_name" "text" NOT NULL,
    "cutoff_time" time without time zone NOT NULL,
    "kitchen_push_time" time without time zone NOT NULL,
    "delivery_start" time without time zone NOT NULL,
    "is_active" boolean DEFAULT true,
    "is_essentials" boolean DEFAULT false,
    "branch_id" integer,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "essentials_label" "text",
    CONSTRAINT "delivery_cycles_push_after_cutoff" CHECK (("kitchen_push_time" >= "cutoff_time"))
);


ALTER TABLE "public"."delivery_cycles" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."delivery_cycles_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."delivery_cycles_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."delivery_cycles_id_seq" OWNED BY "public"."delivery_cycles"."id";



CREATE TABLE IF NOT EXISTS "public"."delivery_hubs" (
    "id" integer NOT NULL,
    "hub_name" "text" NOT NULL,
    "address_details" "text" NOT NULL,
    "contact_phone" "text",
    "branch_id" integer,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "hub_code" "text",
    "polygon_geojson" "jsonb",
    "center_lat" double precision,
    "center_lng" double precision,
    "staff_user_id" "uuid",
    "staff_name" "text",
    "staff_phone" "text",
    "extends_coverage" boolean DEFAULT false NOT NULL,
    "driver_code" "text",
    "delivery_fee_override" numeric,
    "commission_percent" numeric,
    "driver_user_id" "uuid"
);


ALTER TABLE "public"."delivery_hubs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."delivery_hubs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."delivery_hubs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."delivery_hubs_id_seq" OWNED BY "public"."delivery_hubs"."id";



CREATE TABLE IF NOT EXISTS "public"."delivery_zones" (
    "id" integer NOT NULL,
    "zone_name" "text" NOT NULL,
    "description" "text",
    "delivery_fee_override" numeric(10,2) DEFAULT NULL::numeric,
    "is_active" boolean DEFAULT true,
    "branch_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "hub_id" integer,
    "polygon_geojson" "jsonb",
    "driver_code" "text",
    "driver_user_id" "uuid"
);


ALTER TABLE "public"."delivery_zones" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."delivery_zones_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."delivery_zones_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."delivery_zones_id_seq" OWNED BY "public"."delivery_zones"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."employee_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."employee_id_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."essentials_catalog" (
    "id" integer NOT NULL,
    "cycle_id" integer,
    "name" "text" NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "unit" "text" DEFAULT 'piece'::"text",
    "is_active" boolean DEFAULT true,
    "branch_id" integer,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "vendor_id" bigint,
    "daily_cap" integer,
    "vendor_cost" numeric,
    "image_path" "text",
    "image_updated_at" timestamp with time zone,
    "description" "text",
    "listing_status" "text" DEFAULT 'approved'::"text" NOT NULL,
    "submitted_at" timestamp with time zone,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "rejection_reason" "text",
    "plan_eligible" boolean DEFAULT false NOT NULL,
    CONSTRAINT "essentials_catalog_daily_cap_check" CHECK ((("daily_cap" IS NULL) OR ("daily_cap" > 0))),
    CONSTRAINT "essentials_catalog_vendor_cost_check" CHECK ((("vendor_cost" IS NULL) OR ("vendor_cost" >= (0)::numeric))),
    CONSTRAINT "essentials_listing_status_allowed" CHECK (("listing_status" = ANY (ARRAY['draft'::"text", 'pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."essentials_catalog" OWNER TO "postgres";


COMMENT ON COLUMN "public"."essentials_catalog"."vendor_cost" IS 'House-brand only: the agreed rate 1stOne pays the vendor per unit. Own-brand items leave this NULL and are paid from the sale price less commission.';



COMMENT ON COLUMN "public"."essentials_catalog"."image_path" IS 'Path inside the essentials-photos bucket, e.g. essentials-photos/3.jpg. Not a URL — the client builds a resized URL via the storage render endpoint. Set only by an admin until the vendor review gate ships.';



COMMENT ON COLUMN "public"."essentials_catalog"."image_updated_at" IS 'Set on every photo upload. Appended as ?v=<epoch> to bust the CDN cache, which is necessary because the object path is fixed per item.';



COMMENT ON COLUMN "public"."essentials_catalog"."description" IS 'Short customer-facing line under the item name on the Home screen.';



COMMENT ON COLUMN "public"."essentials_catalog"."listing_status" IS 'draft = vendor is still preparing it; pending = with us for review; approved = customer-visible; rejected = sent back. 1stOne''s own rows are always approved. Customers see approved only — enforced in RLS AND again in orderBuild.ts, which bypasses RLS.';



COMMENT ON COLUMN "public"."essentials_catalog"."plan_eligible" IS 'Admin grant: may a CUSTOMER add this to a custom subscription plan?';



CREATE SEQUENCE IF NOT EXISTS "public"."essentials_catalog_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."essentials_catalog_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."essentials_catalog_id_seq" OWNED BY "public"."essentials_catalog"."id";



CREATE TABLE IF NOT EXISTS "public"."expense_claims" (
    "id" integer NOT NULL,
    "staff_id" "uuid",
    "category" "text",
    "description" "text" NOT NULL,
    "amount" numeric(10,2) DEFAULT 0.00,
    "status" "text" DEFAULT 'Pending'::"text",
    "approved_by" "uuid",
    "branch_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "paid_at" timestamp with time zone,
    "hub_id" integer,
    "claim_period" "date",
    CONSTRAINT "expense_claims_category_check" CHECK (("category" = ANY (ARRAY['Grocery'::"text", 'Vegetable'::"text", 'Stationery'::"text", 'Fuel'::"text", 'Others'::"text", 'Expense'::"text", 'Hub Commission'::"text", 'Vendor Payout'::"text"]))),
    CONSTRAINT "expense_claims_status_check" CHECK (("status" = ANY (ARRAY['Pending'::"text", 'Approved'::"text", 'Rejected'::"text", 'Paid'::"text"])))
);


ALTER TABLE "public"."expense_claims" OWNER TO "postgres";


COMMENT ON COLUMN "public"."expense_claims"."hub_id" IS 'Set only on hub-commission claims — the hub the commission belongs to.';



COMMENT ON COLUMN "public"."expense_claims"."claim_period" IS 'Set only on hub-commission claims — first day of the claimed month (IST).';



COMMENT ON CONSTRAINT "expense_claims_category_check" ON "public"."expense_claims" IS 'Staff expense categories plus the two claim types that ride the same Pending → Approved → Paid flow. Add a value here BEFORE shipping any new claim category — three features previously shipped without it and failed silently at insert.';



CREATE SEQUENCE IF NOT EXISTS "public"."expense_claims_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."expense_claims_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."expense_claims_id_seq" OWNED BY "public"."expense_claims"."id";



CREATE TABLE IF NOT EXISTS "public"."feature_flags" (
    "id" integer NOT NULL,
    "flag_key" "text" NOT NULL,
    "flag_value" boolean DEFAULT false,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."feature_flags" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."feature_flags_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."feature_flags_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."feature_flags_id_seq" OWNED BY "public"."feature_flags"."id";



CREATE TABLE IF NOT EXISTS "public"."idempotency_keys" (
    "key" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "response" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."idempotency_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kitchen_push_log" (
    "id" bigint NOT NULL,
    "cycle_id" integer NOT NULL,
    "push_date" "date" NOT NULL,
    "pushed_at" timestamp with time zone DEFAULT "now"(),
    "orders_count" integer DEFAULT 0,
    "items_summary" "text",
    "http_request_id" bigint,
    "notified_at" timestamp with time zone,
    "status" "text",
    "attempts" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."kitchen_push_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kitchen_push_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kitchen_push_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kitchen_push_log_id_seq" OWNED BY "public"."kitchen_push_log"."id";



CREATE TABLE IF NOT EXISTS "public"."loyalty_redemptions" (
    "id" integer NOT NULL,
    "user_id" "uuid",
    "points" integer NOT NULL,
    "type" "text",
    "description" "text",
    "reference_order_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "loyalty_redemptions_type_check" CHECK (("type" = ANY (ARRAY['earned'::"text", 'redeemed'::"text"])))
);


ALTER TABLE "public"."loyalty_redemptions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."loyalty_redemptions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."loyalty_redemptions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."loyalty_redemptions_id_seq" OWNED BY "public"."loyalty_redemptions"."id";



CREATE TABLE IF NOT EXISTS "public"."manifest_run_log" (
    "id" bigint NOT NULL,
    "run_date" "date" NOT NULL,
    "ran_at" timestamp with time zone DEFAULT "now"(),
    "orders_created" integer DEFAULT 0,
    "orders_skipped" integer DEFAULT 0,
    "subs_skipped" integer DEFAULT 0,
    "error_detail" "text"
);


ALTER TABLE "public"."manifest_run_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."manifest_run_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."manifest_run_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."manifest_run_log_id_seq" OWNED BY "public"."manifest_run_log"."id";



CREATE TABLE IF NOT EXISTS "public"."menu_items" (
    "id" integer NOT NULL,
    "cycle_id" integer,
    "name" "text" NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "ingredients" "text",
    "is_active" boolean DEFAULT true,
    "branch_id" integer,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_customer_visible" boolean DEFAULT true NOT NULL,
    "image_path" "text",
    "image_updated_at" timestamp with time zone,
    "description" "text",
    "unit" "text" DEFAULT 'nos'::"text" NOT NULL,
    "base_quantity" numeric DEFAULT 1 NOT NULL,
    "plan_eligible" boolean DEFAULT false NOT NULL,
    CONSTRAINT "menu_items_base_quantity_positive" CHECK (("base_quantity" > (0)::numeric)),
    CONSTRAINT "menu_items_shape" CHECK ((("is_customer_visible" AND ("cycle_id" IS NOT NULL)) OR ((NOT "is_customer_visible") AND ("cycle_id" IS NULL)))),
    CONSTRAINT "menu_items_unit_allowed" CHECK (("unit" = ANY (ARRAY['nos'::"text", 'gms'::"text", 'ml'::"text", 'cup'::"text", 'plate'::"text", 'bowl'::"text"])))
);


ALTER TABLE "public"."menu_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."menu_items"."is_customer_visible" IS 'FALSE = building-block item, admin-only (priced part, hidden from the customer menu). TRUE = customer-facing menu item. DEFAULT TRUE preserves every row that pre-dates the two-stage builder.';



COMMENT ON COLUMN "public"."menu_items"."image_path" IS 'Path inside the menu-photos bucket, e.g. menu-photos/12.jpg. Not a URL — the client builds a resized URL from it via the storage render endpoint.';



COMMENT ON COLUMN "public"."menu_items"."image_updated_at" IS 'Set on every photo upload. Appended as ?v=<epoch> to bust the CDN cache, which is necessary because the object path is fixed per item.';



COMMENT ON COLUMN "public"."menu_items"."description" IS 'Short customer-facing line under the item name on the Home screen.';



COMMENT ON COLUMN "public"."menu_items"."unit" IS 'How this item is measured — one of no, g, ml, cup, plate, bowl. Meaningful on building blocks; a customer-facing dish keeps the default and ignores it.';



COMMENT ON COLUMN "public"."menu_items"."base_quantity" IS 'How much of `unit` the price buys — Sambar ₹20 for 150 ml. Meaningful on a building block, where the price is what a bulk order pays for one of these; a customer-facing dish keeps the default 1 and ignores it. Unrelated to the quantity inside a recipe line, which is what THAT dish contains.';



COMMENT ON COLUMN "public"."menu_items"."plan_eligible" IS 'Admin grant: may a CUSTOMER add this to a custom subscription plan? Only ever meaningful where is_customer_visible = true — a building block is not offerable.';



CREATE SEQUENCE IF NOT EXISTS "public"."menu_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."menu_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."menu_items_id_seq" OWNED BY "public"."menu_items"."id";



CREATE TABLE IF NOT EXISTS "public"."notification_templates" (
    "event_key" "text" NOT NULL,
    "title_template" "text" NOT NULL,
    "body_template" "text" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "trigger_source" "text",
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "variables" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."notification_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_item_ratings" (
    "id" bigint NOT NULL,
    "order_id" bigint NOT NULL,
    "order_item_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "rating" smallint NOT NULL,
    "comments" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "order_item_ratings_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."order_item_ratings" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."order_item_ratings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."order_item_ratings_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."order_item_ratings_id_seq" OWNED BY "public"."order_item_ratings"."id";



CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" integer NOT NULL,
    "order_id" integer,
    "item_id" integer,
    "item_type" "text" DEFAULT 'food'::"text",
    "item_name" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "price_at_time" numeric(10,2) NOT NULL,
    CONSTRAINT "order_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['food'::"text", 'essential'::"text", 'subscription'::"text"])))
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."order_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."order_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."order_items_id_seq" OWNED BY "public"."order_items"."id";



CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" integer NOT NULL,
    "user_id" "uuid",
    "subscription_id" integer,
    "total_amount" numeric(10,2) NOT NULL,
    "tax_amount" numeric(10,2) DEFAULT 0.00,
    "delivery_fee" numeric(10,2) DEFAULT 0.00,
    "status" "text" DEFAULT 'Confirmed'::"text",
    "order_type" "text",
    "dispatch_date" "date" NOT NULL,
    "cycle_id" integer,
    "delivery_method" "text" DEFAULT 'direct'::"text",
    "hub_id" integer,
    "payment_method" "text",
    "razorpay_order_id" "text",
    "wallet_amount_used" numeric(10,2) DEFAULT 0.00,
    "delivery_address_id" integer,
    "branch_id" integer,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "razorpay_payment_id" "text",
    "paid_at" timestamp with time zone,
    "order_group_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "placed_by" "uuid",
    "discount_percent" numeric,
    "razorpay_payment_link_id" "text",
    CONSTRAINT "orders_delivery_method_check" CHECK (("delivery_method" = ANY (ARRAY['direct'::"text", 'hub'::"text"]))),
    CONSTRAINT "orders_discount_percent_range" CHECK ((("discount_percent" IS NULL) OR (("discount_percent" >= (0)::numeric) AND ("discount_percent" <= (100)::numeric)))),
    CONSTRAINT "orders_order_type_check" CHECK (("order_type" = ANY (ARRAY['food'::"text", 'essential'::"text", 'subscription'::"text"]))),
    CONSTRAINT "orders_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['wallet'::"text", 'razorpay'::"text", 'split'::"text", 'account'::"text"]))),
    CONSTRAINT "orders_status_allowed" CHECK (("status" = ANY (ARRAY['Pending'::"text", 'Confirmed'::"text", 'Preparing'::"text", 'Ready'::"text", 'Packed'::"text", 'Dispatched'::"text", 'Received at Hub'::"text", 'On the Way'::"text", 'Delivered'::"text", 'Cancelled'::"text", 'Failed'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


COMMENT ON COLUMN "public"."orders"."placed_by" IS 'The admin who created this order from the back office. NULL = placed by the customer themselves. Also the "is this a bulk/B2B order" discriminator for reporting.';



COMMENT ON COLUMN "public"."orders"."discount_percent" IS 'Admin-entered discount applied to the ITEM subtotal (never the delivery fee). NULL on customer orders. Recorded for the invoice; the discounted price is already reflected in order_items.price_at_time and orders.total_amount.';



COMMENT ON COLUMN "public"."orders"."razorpay_payment_link_id" IS 'Razorpay Payment Link id (plink_…) when the admin chose the payment-link mode. Deliberately NOT razorpay_order_id — four existing code paths match on that column.';



CREATE SEQUENCE IF NOT EXISTS "public"."orders_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."orders_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."orders_id_seq" OWNED BY "public"."orders"."id";



CREATE TABLE IF NOT EXISTS "public"."pending_wallet_topups" (
    "razorpay_order_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "pending_wallet_topups_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."pending_wallet_topups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "phone_number" "text" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'customer'::"text",
    "assigned_hub_id" integer,
    "branch_id" integer,
    "wallet_balance" numeric(10,2) DEFAULT 0.00,
    "loyalty_points" integer DEFAULT 0,
    "referral_code" "text",
    "referred_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "employee_id" "text",
    "designation" "text",
    "joining_date" "date",
    "shift_timing" "text",
    "monthly_salary" numeric DEFAULT 0,
    "benefits" "text",
    "exit_date" "date",
    "is_super_admin" boolean DEFAULT false NOT NULL,
    "vendor_id" bigint,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['customer'::"text", 'staff'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_logs" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "token" "text",
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "trigger_source" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "reference_id" "text",
    "expo_ticket_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error_message" "text",
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "push_logs_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'failed'::"text", 'invalid_token'::"text", 'pending'::"text"])))
);


ALTER TABLE "public"."push_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."push_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."push_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."push_logs_id_seq" OWNED BY "public"."push_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."push_notification_tokens" (
    "id" integer NOT NULL,
    "user_id" "uuid",
    "token" "text" NOT NULL,
    "platform" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "push_notification_tokens_platform_check" CHECK (("platform" = ANY (ARRAY['ios'::"text", 'android'::"text", 'web'::"text"])))
);


ALTER TABLE "public"."push_notification_tokens" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."push_notification_tokens_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."push_notification_tokens_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."push_notification_tokens_id_seq" OWNED BY "public"."push_notification_tokens"."id";



CREATE TABLE IF NOT EXISTS "public"."referral_settings" (
    "id" integer NOT NULL,
    "referrer_reward_points" integer DEFAULT 50,
    "referee_reward_points" integer DEFAULT 50,
    "referrer_wallet_credit" numeric(10,2) DEFAULT 0.00,
    "referee_wallet_credit" numeric(10,2) DEFAULT 0.00,
    "is_active" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "referee_signup_credit" numeric DEFAULT 0,
    "referrer_first_order_points" integer DEFAULT 0,
    "referrer_first_order_credit" numeric DEFAULT 0,
    "referrer_month_credit" numeric DEFAULT 0,
    "milestone_star_count" integer DEFAULT 5,
    "milestone_ambassador_count" integer DEFAULT 25
);


ALTER TABLE "public"."referral_settings" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."referral_settings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."referral_settings_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."referral_settings_id_seq" OWNED BY "public"."referral_settings"."id";



CREATE TABLE IF NOT EXISTS "public"."referrals" (
    "id" integer NOT NULL,
    "referrer_id" "uuid",
    "referee_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text",
    "reward_given" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "first_order_reward_given" boolean DEFAULT false,
    "month_reward_given" boolean DEFAULT false,
    CONSTRAINT "referrals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'first_order_done'::"text", 'month_complete'::"text", 'completed'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."referrals" OWNER TO "postgres";


COMMENT ON CONSTRAINT "referrals_status_check" ON "public"."referrals" IS 'Every state the referral lifecycle actually writes. first_order_done and month_complete were in use by the trigger and the admin screen long before they were permitted here — which let the wallet be credited while the row went unmarked, defeating first_order_reward_given as an idempotency guard. Add the value HERE in the same change that introduces a new state.';



CREATE SEQUENCE IF NOT EXISTS "public"."referrals_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."referrals_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."referrals_id_seq" OWNED BY "public"."referrals"."id";



CREATE TABLE IF NOT EXISTS "public"."seed_360_registry" (
    "id" bigint NOT NULL,
    "run_id" bigint NOT NULL,
    "table_name" "text" NOT NULL,
    "pk" "text" NOT NULL,
    "note" "text"
);


ALTER TABLE "public"."seed_360_registry" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seed_360_registry_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seed_360_registry_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."seed_360_registry_id_seq" OWNED BY "public"."seed_360_registry"."id";



CREATE TABLE IF NOT EXISTS "public"."seed_360_run" (
    "id" bigint NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    "note" "text"
);


ALTER TABLE "public"."seed_360_run" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seed_360_run_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seed_360_run_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."seed_360_run_id_seq" OWNED BY "public"."seed_360_run"."id";



CREATE TABLE IF NOT EXISTS "public"."seed_360_wallet_snapshot" (
    "run_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "balance" numeric NOT NULL,
    "points" integer NOT NULL
);


ALTER TABLE "public"."seed_360_wallet_snapshot" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_attendance" (
    "id" integer NOT NULL,
    "staff_id" "uuid",
    "clock_in_time" timestamp with time zone,
    "clock_out_time" timestamp with time zone,
    "clock_in_lat" numeric(10,7),
    "clock_in_lng" numeric(10,7),
    "clock_out_lat" numeric(10,7),
    "clock_out_lng" numeric(10,7),
    "date" "date" NOT NULL,
    "branch_id" integer
);


ALTER TABLE "public"."staff_attendance" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."staff_attendance_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."staff_attendance_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."staff_attendance_id_seq" OWNED BY "public"."staff_attendance"."id";



CREATE TABLE IF NOT EXISTS "public"."staff_leaves" (
    "id" integer NOT NULL,
    "staff_id" "uuid",
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "reason" "text",
    "status" "text" DEFAULT 'Pending'::"text",
    "approved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "branch_id" integer,
    CONSTRAINT "staff_leaves_status_check" CHECK (("status" = ANY (ARRAY['Pending'::"text", 'Approved'::"text", 'Rejected'::"text"])))
);


ALTER TABLE "public"."staff_leaves" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."staff_leaves_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."staff_leaves_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."staff_leaves_id_seq" OWNED BY "public"."staff_leaves"."id";



CREATE TABLE IF NOT EXISTS "public"."staff_order_requests" (
    "id" integer NOT NULL,
    "request_type" "text" NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'Pending'::"text" NOT NULL,
    "submitted_by" "uuid",
    "approved_by" "uuid",
    "branch_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "staff_order_requests_request_type_check" CHECK (("request_type" = ANY (ARRAY['Vegetables'::"text", 'Grocery'::"text", 'Stationery'::"text"]))),
    CONSTRAINT "staff_order_requests_status_check" CHECK (("status" = ANY (ARRAY['Pending'::"text", 'Approved'::"text", 'Rejected'::"text"])))
);


ALTER TABLE "public"."staff_order_requests" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."staff_order_requests_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."staff_order_requests_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."staff_order_requests_id_seq" OWNED BY "public"."staff_order_requests"."id";



CREATE TABLE IF NOT EXISTS "public"."staff_salary" (
    "id" integer NOT NULL,
    "staff_id" "uuid",
    "month" integer NOT NULL,
    "year" integer NOT NULL,
    "base_salary" numeric(10,2) NOT NULL,
    "deductions" numeric(10,2) DEFAULT 0.00,
    "bonus" numeric(10,2) DEFAULT 0.00,
    "net_salary" numeric(10,2) NOT NULL,
    "is_paid" boolean DEFAULT false,
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "branch_id" integer,
    CONSTRAINT "staff_salary_month_check" CHECK ((("month" >= 1) AND ("month" <= 12)))
);


ALTER TABLE "public"."staff_salary" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."staff_salary_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."staff_salary_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."staff_salary_id_seq" OWNED BY "public"."staff_salary"."id";



CREATE TABLE IF NOT EXISTS "public"."staff_shifts" (
    "id" integer NOT NULL,
    "staff_id" "uuid",
    "shift_name" "text" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "days_of_week" "text"[] DEFAULT ARRAY['Mon'::"text", 'Tue'::"text", 'Wed'::"text", 'Thu'::"text", 'Fri'::"text", 'Sat'::"text"],
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "branch_id" integer
);


ALTER TABLE "public"."staff_shifts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."staff_shifts_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."staff_shifts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."staff_shifts_id_seq" OWNED BY "public"."staff_shifts"."id";



CREATE TABLE IF NOT EXISTS "public"."store_config" (
    "id" integer NOT NULL,
    "tax_rate_percentage" numeric(5,2) DEFAULT 5.00 NOT NULL,
    "delivery_fee" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "cancellation_window_hours" integer DEFAULT 2 NOT NULL,
    "storm_mode_active" boolean DEFAULT false,
    "essentials_module_active" boolean DEFAULT false,
    "hub_delivery_active" boolean DEFAULT false,
    "loyalty_points_per_rupee" numeric(5,2) DEFAULT 0.10,
    "min_wallet_topup" numeric(10,2) DEFAULT 100.00 NOT NULL,
    "whatsapp_support_number" "text" DEFAULT '9448364017'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "low_wallet_threshold" numeric DEFAULT 200 NOT NULL,
    "winback_inactive_days" integer DEFAULT 14,
    "max_wallet_topup" numeric DEFAULT 50000 NOT NULL,
    "max_admin_discount_percent" numeric DEFAULT 15 NOT NULL
);


ALTER TABLE "public"."store_config" OWNER TO "postgres";


COMMENT ON COLUMN "public"."store_config"."max_admin_discount_percent" IS 'Upper bound on the discount an admin may apply when creating a back-office order. Enforced server-side in admin-place-order.';



CREATE SEQUENCE IF NOT EXISTS "public"."store_config_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."store_config_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."store_config_id_seq" OWNED BY "public"."store_config"."id";



CREATE TABLE IF NOT EXISTS "public"."subscription_discount_slabs" (
    "id" bigint NOT NULL,
    "min_days" integer NOT NULL,
    "max_days" integer NOT NULL,
    "percent" numeric(5,2) NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "slab_percent_sane" CHECK ((("percent" >= (0)::numeric) AND ("percent" < (100)::numeric))),
    CONSTRAINT "slab_range_sane" CHECK ((("min_days" >= 1) AND ("max_days" >= "min_days")))
);


ALTER TABLE "public"."subscription_discount_slabs" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscription_discount_slabs" IS 'Length-based discount for CUSTOM plans. Longer commitment, bigger discount. Admin-editable at Manage → Subscriptions.';



CREATE SEQUENCE IF NOT EXISTS "public"."subscription_discount_slabs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."subscription_discount_slabs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."subscription_discount_slabs_id_seq" OWNED BY "public"."subscription_discount_slabs"."id";



CREATE TABLE IF NOT EXISTS "public"."subscription_plan_items" (
    "id" integer NOT NULL,
    "plan_id" integer,
    "item_id" integer NOT NULL,
    "item_type" "text" DEFAULT 'food'::"text",
    "quantity" integer DEFAULT 1,
    CONSTRAINT "subscription_plan_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['food'::"text", 'essential'::"text"])))
);


ALTER TABLE "public"."subscription_plan_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."subscription_plan_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."subscription_plan_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."subscription_plan_items_id_seq" OWNED BY "public"."subscription_plan_items"."id";



CREATE TABLE IF NOT EXISTS "public"."subscription_plans" (
    "id" integer NOT NULL,
    "cycle_id" integer,
    "plan_name" "text" NOT NULL,
    "duration_days" integer NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "savings_amount" numeric(10,2) DEFAULT 0.00,
    "is_active" boolean DEFAULT true,
    "plan_type" "text",
    "branch_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "plan_items" "text",
    "is_custom" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "image_path" "text",
    "image_updated_at" timestamp with time zone,
    CONSTRAINT "subscription_plans_plan_type_check" CHECK (("plan_type" = ANY (ARRAY['food'::"text", 'essentials'::"text"])))
);


ALTER TABLE "public"."subscription_plans" OWNER TO "postgres";


COMMENT ON COLUMN "public"."subscription_plans"."is_custom" IS 'True for a plan a customer built for themselves. Excluded from every browse list, the admin plan manager and plan-wise reports; reachable only by its owner.';



COMMENT ON COLUMN "public"."subscription_plans"."created_by" IS 'The customer who built a custom plan. NULL for admin-listed plans.';



COMMENT ON COLUMN "public"."subscription_plans"."image_path" IS 'Storage key of the plan photo — plan-photos/<id>.jpg. Build a URL with photoUrl (src/utils/catalogPhoto.ts).';



COMMENT ON COLUMN "public"."subscription_plans"."image_updated_at" IS 'Stamped on every upload; busts the CDN cache for a replaced photo.';



CREATE SEQUENCE IF NOT EXISTS "public"."subscription_plans_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."subscription_plans_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."subscription_plans_id_seq" OWNED BY "public"."subscription_plans"."id";



CREATE TABLE IF NOT EXISTS "public"."supply_batches" (
    "id" integer NOT NULL,
    "printed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "printed_by" "uuid",
    "items_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "note" "text",
    "branch_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."supply_batches" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."supply_batches_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."supply_batches_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."supply_batches_id_seq" OWNED BY "public"."supply_batches"."id";



CREATE TABLE IF NOT EXISTS "public"."supply_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."supply_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supply_order_items" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "qty" integer DEFAULT 1 NOT NULL,
    "category" "text" NOT NULL,
    "request_id" integer,
    "batch_id" integer,
    "added_by" "uuid",
    "branch_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supply_order_items_category_check" CHECK (("category" = ANY (ARRAY['Vegetables'::"text", 'Grocery'::"text", 'Stationery'::"text"])))
);


ALTER TABLE "public"."supply_order_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."supply_order_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."supply_order_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."supply_order_items_id_seq" OWNED BY "public"."supply_order_items"."id";



CREATE TABLE IF NOT EXISTS "public"."user_subscriptions" (
    "id" integer NOT NULL,
    "user_id" "uuid",
    "plan_id" integer,
    "start_date" "date" NOT NULL,
    "days_consumed" integer DEFAULT 0,
    "is_paused" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "payment_method" "text",
    "razorpay_order_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "branch_id" integer,
    "wallet_amount_used" numeric DEFAULT 0,
    "razorpay_payment_id" "text",
    CONSTRAINT "user_subscriptions_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['wallet'::"text", 'razorpay'::"text", 'split'::"text"])))
);


ALTER TABLE "public"."user_subscriptions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."user_subscriptions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."user_subscriptions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."user_subscriptions_id_seq" OWNED BY "public"."user_subscriptions"."id";



CREATE TABLE IF NOT EXISTS "public"."vendor_earnings" (
    "id" bigint NOT NULL,
    "vendor_id" bigint NOT NULL,
    "order_id" bigint NOT NULL,
    "order_item_id" bigint NOT NULL,
    "gross_amount" numeric NOT NULL,
    "commission_percent" numeric NOT NULL,
    "commission_amount" numeric NOT NULL,
    "net_amount" numeric NOT NULL,
    "selling_model" "text" NOT NULL,
    "wallet_transaction_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vendor_earnings" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."vendor_earnings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."vendor_earnings_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."vendor_earnings_id_seq" OWNED BY "public"."vendor_earnings"."id";



CREATE TABLE IF NOT EXISTS "public"."vendor_listing_changes" (
    "id" bigint NOT NULL,
    "item_id" integer NOT NULL,
    "vendor_id" bigint NOT NULL,
    "proposed" "jsonb" NOT NULL,
    "photo_pending" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "rejection_reason" "text",
    CONSTRAINT "vendor_listing_changes_status_allowed" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."vendor_listing_changes" OWNER TO "postgres";


COMMENT ON TABLE "public"."vendor_listing_changes" IS 'Proposed edits to vendor listings that are already approved and selling. The live essentials_catalog row is untouched until an admin approves, so nothing goes off sale during review. New listings do NOT appear here — they are staged in place as listing_status=draft/pending.';



CREATE SEQUENCE IF NOT EXISTS "public"."vendor_listing_changes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."vendor_listing_changes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."vendor_listing_changes_id_seq" OWNED BY "public"."vendor_listing_changes"."id";



CREATE TABLE IF NOT EXISTS "public"."vendor_order_fulfilment" (
    "id" bigint NOT NULL,
    "vendor_id" bigint NOT NULL,
    "order_id" bigint NOT NULL,
    "ready_at" timestamp with time zone,
    "ready_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vendor_order_fulfilment" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."vendor_order_fulfilment_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."vendor_order_fulfilment_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."vendor_order_fulfilment_id_seq" OWNED BY "public"."vendor_order_fulfilment"."id";



CREATE OR REPLACE VIEW "public"."vendor_public" AS
 SELECT "id",
    "business_name"
   FROM "public"."vendors" "v"
  WHERE ("status" = 'approved'::"text");


ALTER VIEW "public"."vendor_public" OWNER TO "postgres";


COMMENT ON VIEW "public"."vendor_public" IS 'Trading name only, approved vendors only. Exists so the storefront can show "Sold by X" without exposing GST, FSSAI or commission from the vendors table.';



CREATE TABLE IF NOT EXISTS "public"."vendor_zones" (
    "id" bigint NOT NULL,
    "vendor_id" bigint NOT NULL,
    "zone_id" integer,
    "hub_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vendor_zones_one_target" CHECK ((("zone_id" IS NULL) <> ("hub_id" IS NULL)))
);


ALTER TABLE "public"."vendor_zones" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."vendor_zones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."vendor_zones_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."vendor_zones_id_seq" OWNED BY "public"."vendor_zones"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."vendors_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."vendors_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."vendors_id_seq" OWNED BY "public"."vendors"."id";



CREATE TABLE IF NOT EXISTS "public"."wallet_transactions" (
    "id" integer NOT NULL,
    "user_id" "uuid",
    "amount" numeric(10,2) NOT NULL,
    "transaction_type" "text",
    "description" "text" NOT NULL,
    "reference_type" "text",
    "reference_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "wallet_transactions_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['credit'::"text", 'debit'::"text"])))
);


ALTER TABLE "public"."wallet_transactions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wallet_transactions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wallet_transactions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wallet_transactions_id_seq" OWNED BY "public"."wallet_transactions"."id";



ALTER TABLE ONLY "public"."admin_notes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."admin_notes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_feedback" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."app_feedback_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."attendance_correction_days" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."attendance_correction_days_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."attendance_correction_requests" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."attendance_correction_requests_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."banners" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."banners_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."branches" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."branches_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."business_expenses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."business_expenses_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cancelled_subscription_days" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cancelled_subscription_days_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."customer_addresses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."customer_addresses_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."delivery_cycles" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."delivery_cycles_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."delivery_hubs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."delivery_hubs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."delivery_zones" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."delivery_zones_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."essentials_catalog" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."essentials_catalog_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."expense_claims" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."expense_claims_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."feature_flags" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."feature_flags_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kitchen_push_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kitchen_push_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."loyalty_redemptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."loyalty_redemptions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."manifest_run_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."manifest_run_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."menu_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."menu_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."order_item_ratings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."order_item_ratings_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."order_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."order_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."orders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."orders_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."push_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."push_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."push_notification_tokens" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."push_notification_tokens_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."referral_settings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."referral_settings_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."referrals" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."referrals_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."seed_360_registry" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."seed_360_registry_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."seed_360_run" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."seed_360_run_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_attendance" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_attendance_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_leaves" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_leaves_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_order_requests" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_order_requests_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_salary" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_salary_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_shifts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_shifts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."store_config" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."store_config_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subscription_discount_slabs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subscription_discount_slabs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subscription_plan_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subscription_plan_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subscription_plans" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subscription_plans_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."supply_batches" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."supply_batches_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."supply_order_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."supply_order_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."user_subscriptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_subscriptions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."vendor_earnings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."vendor_earnings_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."vendor_listing_changes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."vendor_listing_changes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."vendor_order_fulfilment" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."vendor_order_fulfilment_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."vendor_zones" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."vendor_zones_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."vendors" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."vendors_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wallet_transactions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wallet_transactions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."admin_notes"
    ADD CONSTRAINT "admin_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_notes"
    ADD CONSTRAINT "admin_notes_target_branch_unique" UNIQUE NULLS NOT DISTINCT ("target_tab", "branch_id");



ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."app_feedback"
    ADD CONSTRAINT "app_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_correction_days"
    ADD CONSTRAINT "attendance_correction_days_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_correction_days"
    ADD CONSTRAINT "attendance_correction_days_request_id_the_date_key" UNIQUE ("request_id", "the_date");



ALTER TABLE ONLY "public"."attendance_correction_requests"
    ADD CONSTRAINT "attendance_correction_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."banners"
    ADD CONSTRAINT "banners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_expenses"
    ADD CONSTRAINT "business_expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cancelled_subscription_days"
    ADD CONSTRAINT "cancelled_subscription_days_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cancelled_subscription_days"
    ADD CONSTRAINT "cancelled_subscription_days_subscription_id_cancelled_date__key" UNIQUE ("subscription_id", "cancelled_date", "cycle_id");



ALTER TABLE ONLY "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_cycles"
    ADD CONSTRAINT "delivery_cycles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_hubs"
    ADD CONSTRAINT "delivery_hubs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_zones"
    ADD CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."essentials_catalog"
    ADD CONSTRAINT "essentials_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense_claims"
    ADD CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_flag_key_key" UNIQUE ("flag_key");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."kitchen_push_log"
    ADD CONSTRAINT "kitchen_push_log_cycle_id_push_date_key" UNIQUE ("cycle_id", "push_date");



ALTER TABLE ONLY "public"."kitchen_push_log"
    ADD CONSTRAINT "kitchen_push_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_redemptions"
    ADD CONSTRAINT "loyalty_redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."manifest_run_log"
    ADD CONSTRAINT "manifest_run_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_templates"
    ADD CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("event_key");



ALTER TABLE ONLY "public"."order_item_ratings"
    ADD CONSTRAINT "order_item_ratings_order_id_order_item_id_user_id_key" UNIQUE ("order_id", "order_item_id", "user_id");



ALTER TABLE ONLY "public"."order_item_ratings"
    ADD CONSTRAINT "order_item_ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_wallet_topups"
    ADD CONSTRAINT "pending_wallet_topups_pkey" PRIMARY KEY ("razorpay_order_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_phone_number_key" UNIQUE ("phone_number");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."push_logs"
    ADD CONSTRAINT "push_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_notification_tokens"
    ADD CONSTRAINT "push_notification_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_notification_tokens"
    ADD CONSTRAINT "push_notification_tokens_user_id_token_key" UNIQUE ("user_id", "token");



ALTER TABLE ONLY "public"."referral_settings"
    ADD CONSTRAINT "referral_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seed_360_registry"
    ADD CONSTRAINT "seed_360_registry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seed_360_run"
    ADD CONSTRAINT "seed_360_run_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seed_360_wallet_snapshot"
    ADD CONSTRAINT "seed_360_wallet_snapshot_pkey" PRIMARY KEY ("run_id", "user_id");



ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_staff_date_unique" UNIQUE ("staff_id", "date");



ALTER TABLE ONLY "public"."staff_leaves"
    ADD CONSTRAINT "staff_leaves_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_order_requests"
    ADD CONSTRAINT "staff_order_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_salary"
    ADD CONSTRAINT "staff_salary_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_salary"
    ADD CONSTRAINT "staff_salary_staff_id_month_year_key" UNIQUE ("staff_id", "month", "year");



ALTER TABLE ONLY "public"."staff_shifts"
    ADD CONSTRAINT "staff_shifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."store_config"
    ADD CONSTRAINT "store_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_discount_slabs"
    ADD CONSTRAINT "subscription_discount_slabs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_plan_items"
    ADD CONSTRAINT "subscription_plan_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supply_batches"
    ADD CONSTRAINT "supply_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supply_catalog"
    ADD CONSTRAINT "supply_catalog_name_category_key" UNIQUE ("name", "category");



ALTER TABLE ONLY "public"."supply_catalog"
    ADD CONSTRAINT "supply_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supply_order_items"
    ADD CONSTRAINT "supply_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_earnings"
    ADD CONSTRAINT "vendor_earnings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_listing_changes"
    ADD CONSTRAINT "vendor_listing_changes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_order_fulfilment"
    ADD CONSTRAINT "vendor_order_fulfilment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_zones"
    ADD CONSTRAINT "vendor_zones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "customer_addresses_one_default_per_user" ON "public"."customer_addresses" USING "btree" ("user_id") WHERE ("is_default" = true);



CREATE INDEX "essentials_plan_eligible_idx" ON "public"."essentials_catalog" USING "btree" ("cycle_id") WHERE "plan_eligible";



CREATE INDEX "idx_addresses_hub" ON "public"."customer_addresses" USING "btree" ("hub_id");



CREATE INDEX "idx_addresses_user" ON "public"."customer_addresses" USING "btree" ("user_id");



CREATE INDEX "idx_addresses_zone" ON "public"."customer_addresses" USING "btree" ("zone_id");



CREATE INDEX "idx_attendance_correction_days_request" ON "public"."attendance_correction_days" USING "btree" ("request_id");



CREATE INDEX "idx_attendance_correction_requests_staff" ON "public"."attendance_correction_requests" USING "btree" ("staff_id");



CREATE INDEX "idx_attendance_correction_requests_status_branch" ON "public"."attendance_correction_requests" USING "btree" ("status", "branch_id");



CREATE INDEX "idx_attendance_date" ON "public"."staff_attendance" USING "btree" ("date");



CREATE INDEX "idx_attendance_staff" ON "public"."staff_attendance" USING "btree" ("staff_id");



CREATE INDEX "idx_cancelled_days_date" ON "public"."cancelled_subscription_days" USING "btree" ("cancelled_date");



CREATE INDEX "idx_cancelled_days_sub" ON "public"."cancelled_subscription_days" USING "btree" ("subscription_id");



CREATE INDEX "idx_cancelled_subscription_days_branch" ON "public"."cancelled_subscription_days" USING "btree" ("branch_id");



CREATE INDEX "idx_cancelled_subscription_days_cycle_id" ON "public"."cancelled_subscription_days" USING "btree" ("cycle_id");



CREATE INDEX "idx_customer_addresses_branch" ON "public"."customer_addresses" USING "btree" ("branch_id");



CREATE INDEX "idx_delivery_cycles_active" ON "public"."delivery_cycles" USING "btree" ("is_active");



CREATE INDEX "idx_delivery_cycles_branch" ON "public"."delivery_cycles" USING "btree" ("branch_id");



CREATE INDEX "idx_delivery_hubs_active" ON "public"."delivery_hubs" USING "btree" ("is_active");



CREATE INDEX "idx_essentials_active" ON "public"."essentials_catalog" USING "btree" ("is_active");



CREATE INDEX "idx_essentials_cycle" ON "public"."essentials_catalog" USING "btree" ("cycle_id");



CREATE INDEX "idx_essentials_listing_status" ON "public"."essentials_catalog" USING "btree" ("listing_status") WHERE ("listing_status" <> 'approved'::"text");



CREATE INDEX "idx_essentials_vendor" ON "public"."essentials_catalog" USING "btree" ("vendor_id") WHERE ("vendor_id" IS NOT NULL);



CREATE INDEX "idx_expense_staff" ON "public"."expense_claims" USING "btree" ("staff_id");



CREATE INDEX "idx_expense_status" ON "public"."expense_claims" USING "btree" ("status");



CREATE INDEX "idx_feedback_order" ON "public"."app_feedback" USING "btree" ("order_id");



CREATE INDEX "idx_feedback_user" ON "public"."app_feedback" USING "btree" ("user_id");



CREATE INDEX "idx_idempotency_keys_user" ON "public"."idempotency_keys" USING "btree" ("user_id");



CREATE INDEX "idx_leaves_staff" ON "public"."staff_leaves" USING "btree" ("staff_id");



CREATE INDEX "idx_leaves_status" ON "public"."staff_leaves" USING "btree" ("status");



CREATE INDEX "idx_loyalty_user" ON "public"."loyalty_redemptions" USING "btree" ("user_id");



CREATE INDEX "idx_menu_items_active" ON "public"."menu_items" USING "btree" ("is_active");



CREATE INDEX "idx_menu_items_branch" ON "public"."menu_items" USING "btree" ("branch_id");



CREATE INDEX "idx_menu_items_cycle" ON "public"."menu_items" USING "btree" ("cycle_id");



CREATE INDEX "idx_order_item_ratings_order_item_id" ON "public"."order_item_ratings" USING "btree" ("order_item_id");



CREATE INDEX "idx_order_item_ratings_user_id" ON "public"."order_item_ratings" USING "btree" ("user_id");



CREATE INDEX "idx_order_items_order" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "idx_orders_branch" ON "public"."orders" USING "btree" ("branch_id");



CREATE INDEX "idx_orders_created" ON "public"."orders" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_orders_cycle" ON "public"."orders" USING "btree" ("cycle_id");



CREATE INDEX "idx_orders_cycle_dispatch" ON "public"."orders" USING "btree" ("cycle_id", "dispatch_date");



CREATE INDEX "idx_orders_delivery_address_id" ON "public"."orders" USING "btree" ("delivery_address_id");



CREATE INDEX "idx_orders_dispatch" ON "public"."orders" USING "btree" ("dispatch_date");



CREATE INDEX "idx_orders_group" ON "public"."orders" USING "btree" ("order_group_id");



CREATE INDEX "idx_orders_hub" ON "public"."orders" USING "btree" ("hub_id");



CREATE INDEX "idx_orders_placed_by" ON "public"."orders" USING "btree" ("placed_by") WHERE ("placed_by" IS NOT NULL);



CREATE INDEX "idx_orders_status" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "idx_orders_sub" ON "public"."orders" USING "btree" ("subscription_id");



CREATE INDEX "idx_orders_type" ON "public"."orders" USING "btree" ("order_type");



CREATE INDEX "idx_orders_undelivered_past" ON "public"."orders" USING "btree" ("dispatch_date") WHERE ("status" <> ALL (ARRAY['Delivered'::"text", 'Cancelled'::"text", 'Failed'::"text"]));



CREATE INDEX "idx_orders_user" ON "public"."orders" USING "btree" ("user_id");



CREATE INDEX "idx_pending_topups_user" ON "public"."pending_wallet_topups" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_branch" ON "public"."profiles" USING "btree" ("branch_id");



CREATE INDEX "idx_profiles_is_super_admin" ON "public"."profiles" USING "btree" ("is_super_admin") WHERE ("is_super_admin" = true);



CREATE INDEX "idx_profiles_phone" ON "public"."profiles" USING "btree" ("phone_number");



CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "idx_push_tokens_user" ON "public"."push_notification_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_referrals_referee" ON "public"."referrals" USING "btree" ("referee_id");



CREATE INDEX "idx_referrals_referrer" ON "public"."referrals" USING "btree" ("referrer_id");



CREATE INDEX "idx_salary_staff" ON "public"."staff_salary" USING "btree" ("staff_id");



CREATE INDEX "idx_shifts_staff" ON "public"."staff_shifts" USING "btree" ("staff_id");



CREATE INDEX "idx_staff_attendance_branch_id" ON "public"."staff_attendance" USING "btree" ("branch_id");



CREATE INDEX "idx_staff_leaves_branch" ON "public"."staff_leaves" USING "btree" ("branch_id");



CREATE INDEX "idx_staff_salary_branch" ON "public"."staff_salary" USING "btree" ("branch_id");



CREATE INDEX "idx_staff_shifts_branch" ON "public"."staff_shifts" USING "btree" ("branch_id");



CREATE INDEX "idx_sub_plan_items_plan" ON "public"."subscription_plan_items" USING "btree" ("plan_id");



CREATE INDEX "idx_sub_plans_active" ON "public"."subscription_plans" USING "btree" ("is_active");



CREATE INDEX "idx_sub_plans_cycle" ON "public"."subscription_plans" USING "btree" ("cycle_id");



CREATE INDEX "idx_sub_plans_type" ON "public"."subscription_plans" USING "btree" ("plan_type");



CREATE INDEX "idx_user_subs_active" ON "public"."user_subscriptions" USING "btree" ("is_active", "is_paused");



CREATE INDEX "idx_user_subs_plan" ON "public"."user_subscriptions" USING "btree" ("plan_id");



CREATE INDEX "idx_user_subs_user" ON "public"."user_subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_user_subscriptions_branch" ON "public"."user_subscriptions" USING "btree" ("branch_id");



CREATE INDEX "idx_vendor_earnings_order_id" ON "public"."vendor_earnings" USING "btree" ("order_id");



CREATE INDEX "idx_vendor_earnings_vendor" ON "public"."vendor_earnings" USING "btree" ("vendor_id", "created_at" DESC);



CREATE INDEX "idx_vendor_earnings_wallet_transaction_id" ON "public"."vendor_earnings" USING "btree" ("wallet_transaction_id");



CREATE INDEX "idx_vendor_listing_changes_pending" ON "public"."vendor_listing_changes" USING "btree" ("submitted_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_vendor_listing_changes_vendor_id" ON "public"."vendor_listing_changes" USING "btree" ("vendor_id");



CREATE INDEX "idx_vendor_order_fulfilment_order_id" ON "public"."vendor_order_fulfilment" USING "btree" ("order_id");



CREATE INDEX "idx_vendor_zones_hub_lookup" ON "public"."vendor_zones" USING "btree" ("hub_id") WHERE ("hub_id" IS NOT NULL);



CREATE INDEX "idx_vendor_zones_zone_lookup" ON "public"."vendor_zones" USING "btree" ("zone_id") WHERE ("zone_id" IS NOT NULL);



CREATE INDEX "idx_vendors_status" ON "public"."vendors" USING "btree" ("status") WHERE ("status" <> 'approved'::"text");



CREATE INDEX "idx_wallet_tx_created" ON "public"."wallet_transactions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_wallet_tx_user" ON "public"."wallet_transactions" USING "btree" ("user_id");



CREATE INDEX "idx_wallet_tx_user_created" ON "public"."wallet_transactions" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "kitchen_push_log_unconfirmed_idx" ON "public"."kitchen_push_log" USING "btree" ("cycle_id", "push_date") WHERE ("notified_at" IS NULL);



CREATE INDEX "menu_items_plan_eligible_idx" ON "public"."menu_items" USING "btree" ("cycle_id") WHERE "plan_eligible";



CREATE INDEX "order_item_ratings_order_idx" ON "public"."order_item_ratings" USING "btree" ("order_id");



CREATE INDEX "push_logs_sent_at_idx" ON "public"."push_logs" USING "btree" ("sent_at" DESC);



CREATE INDEX "push_logs_status_idx" ON "public"."push_logs" USING "btree" ("status");



CREATE INDEX "push_logs_trigger_idx" ON "public"."push_logs" USING "btree" ("trigger_source", "sent_at" DESC);



CREATE INDEX "push_logs_user_id_idx" ON "public"."push_logs" USING "btree" ("user_id");



CREATE INDEX "subscription_plans_listed_idx" ON "public"."subscription_plans" USING "btree" ("cycle_id") WHERE (NOT "is_custom");



CREATE INDEX "subscription_plans_owner_idx" ON "public"."subscription_plans" USING "btree" ("created_by") WHERE "is_custom";



CREATE UNIQUE INDEX "ux_expense_claims_hub_period" ON "public"."expense_claims" USING "btree" ("hub_id", "claim_period") WHERE ("hub_id" IS NOT NULL);



CREATE UNIQUE INDEX "ux_menu_block_name" ON "public"."menu_items" USING "btree" ("lower"("name")) WHERE (NOT "is_customer_visible");



CREATE UNIQUE INDEX "ux_menu_dish_name_cycle" ON "public"."menu_items" USING "btree" ("lower"("name"), "cycle_id") WHERE "is_customer_visible";



CREATE UNIQUE INDEX "ux_orders_subscription_dispatch_type" ON "public"."orders" USING "btree" ("subscription_id", "dispatch_date", "order_type") WHERE ("subscription_id" IS NOT NULL);



CREATE UNIQUE INDEX "ux_vendor_earnings_order_item" ON "public"."vendor_earnings" USING "btree" ("order_item_id");



CREATE UNIQUE INDEX "ux_vendor_listing_changes_one_open" ON "public"."vendor_listing_changes" USING "btree" ("item_id") WHERE ("status" = 'pending'::"text");



CREATE UNIQUE INDEX "ux_vendor_order_fulfilment" ON "public"."vendor_order_fulfilment" USING "btree" ("vendor_id", "order_id");



CREATE UNIQUE INDEX "ux_vendor_zones_hub" ON "public"."vendor_zones" USING "btree" ("vendor_id", "hub_id") WHERE ("hub_id" IS NOT NULL);



CREATE UNIQUE INDEX "ux_vendor_zones_zone" ON "public"."vendor_zones" USING "btree" ("vendor_id", "zone_id") WHERE ("zone_id" IS NOT NULL);



CREATE UNIQUE INDEX "ux_vendors_owner_user" ON "public"."vendors" USING "btree" ("owner_user_id");



CREATE OR REPLACE TRIGGER "staff_order_requests_mirror" AFTER INSERT ON "public"."staff_order_requests" FOR EACH ROW EXECUTE FUNCTION "public"."mirror_staff_request_to_supply_items"();



CREATE OR REPLACE TRIGGER "trg_address_branch_id" BEFORE INSERT OR UPDATE OF "hub_id", "zone_id" ON "public"."customer_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."derive_address_branch_id"();



CREATE OR REPLACE TRIGGER "trg_address_resolve" BEFORE INSERT OR UPDATE ON "public"."customer_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."resolve_address_on_write"();



CREATE OR REPLACE TRIGGER "trg_addresses_updated" BEFORE UPDATE ON "public"."customer_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_admin_notes_updated" BEFORE UPDATE ON "public"."admin_notes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_attendance_correction_branch_id" BEFORE INSERT ON "public"."attendance_correction_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_attendance_correction_branch_id"();



CREATE OR REPLACE TRIGGER "trg_attendance_correction_requests_updated" BEFORE UPDATE ON "public"."attendance_correction_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_banners_updated" BEFORE UPDATE ON "public"."banners" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_branches_updated" BEFORE UPDATE ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_cancelled_day_branch_id" BEFORE INSERT ON "public"."cancelled_subscription_days" FOR EACH ROW EXECUTE FUNCTION "public"."set_cancelled_day_branch_id"();



CREATE OR REPLACE TRIGGER "trg_credit_vendor_earnings" AFTER UPDATE OF "status" ON "public"."orders" FOR EACH ROW WHEN ((("new"."status" = 'Delivered'::"text") AND ("old"."status" IS DISTINCT FROM 'Delivered'::"text"))) EXECUTE FUNCTION "public"."trg_credit_vendor_earnings"();



CREATE OR REPLACE TRIGGER "trg_delivery_cycles_updated" BEFORE UPDATE ON "public"."delivery_cycles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_delivery_hubs_updated" BEFORE UPDATE ON "public"."delivery_hubs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_delivery_zones_updated" BEFORE UPDATE ON "public"."delivery_zones" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_essentials_updated" BEFORE UPDATE ON "public"."essentials_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_expense_claim_branch_id" BEFORE INSERT ON "public"."expense_claims" FOR EACH ROW EXECUTE FUNCTION "public"."set_expense_claim_branch_id"();



CREATE OR REPLACE TRIGGER "trg_expense_updated" BEFORE UPDATE ON "public"."expense_claims" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_feature_flags_updated" BEFORE UPDATE ON "public"."feature_flags" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_first_order_referral_bonus" AFTER INSERT OR UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."handle_first_order_referral_bonus"();



CREATE OR REPLACE TRIGGER "trg_hub_driver_code" BEFORE INSERT OR UPDATE ON "public"."delivery_hubs" FOR EACH ROW EXECUTE FUNCTION "public"."derive_driver_code"();



CREATE OR REPLACE TRIGGER "trg_leaves_updated" BEFORE UPDATE ON "public"."staff_leaves" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_menu_items_updated" BEFORE UPDATE ON "public"."menu_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_orders_status_no_regress" BEFORE UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."orders_status_no_regress"();



CREATE OR REPLACE TRIGGER "trg_orders_updated" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_profiles_branch_id" BEFORE INSERT OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."derive_profile_branch_id"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_push_tokens_updated" BEFORE UPDATE ON "public"."push_notification_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_referral_settings_updated" BEFORE UPDATE ON "public"."referral_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_salary_updated" BEFORE UPDATE ON "public"."staff_salary" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_shifts_updated" BEFORE UPDATE ON "public"."staff_shifts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_staff_order_request_branch_id" BEFORE INSERT ON "public"."staff_order_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_staff_order_request_branch_id"();



CREATE OR REPLACE TRIGGER "trg_store_config_updated" BEFORE UPDATE ON "public"."store_config" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_sub_plans_updated" BEFORE UPDATE ON "public"."subscription_plans" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_user_subs_updated" BEFORE UPDATE ON "public"."user_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_vendor_listing_edit_guard" BEFORE UPDATE ON "public"."essentials_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."vendor_listing_edit_guard"();



CREATE OR REPLACE TRIGGER "trg_vendor_payout_paid" AFTER UPDATE OF "status" ON "public"."expense_claims" FOR EACH ROW WHEN ((("new"."status" = 'Paid'::"text") AND ("old"."status" IS DISTINCT FROM 'Paid'::"text"))) EXECUTE FUNCTION "public"."trg_vendor_payout_paid"();



CREATE OR REPLACE TRIGGER "trg_zone_driver_code" BEFORE INSERT OR UPDATE ON "public"."delivery_zones" FOR EACH ROW EXECUTE FUNCTION "public"."derive_driver_code"();



ALTER TABLE ONLY "public"."admin_notes"
    ADD CONSTRAINT "admin_notes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."admin_notes"
    ADD CONSTRAINT "admin_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."app_feedback"
    ADD CONSTRAINT "app_feedback_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."app_feedback"
    ADD CONSTRAINT "app_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."attendance_correction_days"
    ADD CONSTRAINT "attendance_correction_days_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."attendance_correction_requests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance_correction_requests"
    ADD CONSTRAINT "attendance_correction_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."attendance_correction_requests"
    ADD CONSTRAINT "attendance_correction_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."attendance_correction_requests"
    ADD CONSTRAINT "attendance_correction_requests_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."banners"
    ADD CONSTRAINT "banners_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."business_expenses"
    ADD CONSTRAINT "business_expenses_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."cancelled_subscription_days"
    ADD CONSTRAINT "cancelled_subscription_days_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."cancelled_subscription_days"
    ADD CONSTRAINT "cancelled_subscription_days_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "public"."delivery_cycles"("id");



ALTER TABLE ONLY "public"."cancelled_subscription_days"
    ADD CONSTRAINT "cancelled_subscription_days_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_subscriptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "public"."delivery_hubs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_addresses"
    ADD CONSTRAINT "customer_addresses_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."delivery_cycles"
    ADD CONSTRAINT "delivery_cycles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."delivery_hubs"
    ADD CONSTRAINT "delivery_hubs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."delivery_hubs"
    ADD CONSTRAINT "delivery_hubs_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."delivery_hubs"
    ADD CONSTRAINT "delivery_hubs_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."delivery_zones"
    ADD CONSTRAINT "delivery_zones_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."delivery_zones"
    ADD CONSTRAINT "delivery_zones_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."delivery_zones"
    ADD CONSTRAINT "delivery_zones_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "public"."delivery_hubs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."essentials_catalog"
    ADD CONSTRAINT "essentials_catalog_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."essentials_catalog"
    ADD CONSTRAINT "essentials_catalog_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "public"."delivery_cycles"("id");



ALTER TABLE ONLY "public"."essentials_catalog"
    ADD CONSTRAINT "essentials_catalog_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."essentials_catalog"
    ADD CONSTRAINT "essentials_catalog_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."expense_claims"
    ADD CONSTRAINT "expense_claims_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."expense_claims"
    ADD CONSTRAINT "expense_claims_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."expense_claims"
    ADD CONSTRAINT "expense_claims_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "public"."delivery_hubs"("id");



ALTER TABLE ONLY "public"."expense_claims"
    ADD CONSTRAINT "expense_claims_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."kitchen_push_log"
    ADD CONSTRAINT "kitchen_push_log_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "public"."delivery_cycles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_redemptions"
    ADD CONSTRAINT "loyalty_redemptions_reference_order_id_fkey" FOREIGN KEY ("reference_order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."loyalty_redemptions"
    ADD CONSTRAINT "loyalty_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "public"."delivery_cycles"("id");



ALTER TABLE ONLY "public"."order_item_ratings"
    ADD CONSTRAINT "order_item_ratings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_item_ratings"
    ADD CONSTRAINT "order_item_ratings_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_item_ratings"
    ADD CONSTRAINT "order_item_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "public"."delivery_cycles"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_delivery_address_id_fkey" FOREIGN KEY ("delivery_address_id") REFERENCES "public"."customer_addresses"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "public"."delivery_hubs"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_placed_by_fkey" FOREIGN KEY ("placed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_subscriptions"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."pending_wallet_topups"
    ADD CONSTRAINT "pending_wallet_topups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."push_logs"
    ADD CONSTRAINT "push_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."push_notification_tokens"
    ADD CONSTRAINT "push_notification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referee_id_fkey" FOREIGN KEY ("referee_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."seed_360_registry"
    ADD CONSTRAINT "seed_360_registry_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."seed_360_run"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seed_360_wallet_snapshot"
    ADD CONSTRAINT "seed_360_wallet_snapshot_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."seed_360_run"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."staff_attendance"
    ADD CONSTRAINT "staff_attendance_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."staff_leaves"
    ADD CONSTRAINT "staff_leaves_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."staff_leaves"
    ADD CONSTRAINT "staff_leaves_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."staff_leaves"
    ADD CONSTRAINT "staff_leaves_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."staff_order_requests"
    ADD CONSTRAINT "staff_order_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staff_order_requests"
    ADD CONSTRAINT "staff_order_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staff_order_requests"
    ADD CONSTRAINT "staff_order_requests_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staff_salary"
    ADD CONSTRAINT "staff_salary_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."staff_salary"
    ADD CONSTRAINT "staff_salary_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."staff_shifts"
    ADD CONSTRAINT "staff_shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."staff_shifts"
    ADD CONSTRAINT "staff_shifts_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."subscription_plan_items"
    ADD CONSTRAINT "subscription_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "public"."delivery_cycles"("id");



ALTER TABLE ONLY "public"."supply_batches"
    ADD CONSTRAINT "supply_batches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supply_batches"
    ADD CONSTRAINT "supply_batches_printed_by_fkey" FOREIGN KEY ("printed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supply_order_items"
    ADD CONSTRAINT "supply_order_items_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supply_order_items"
    ADD CONSTRAINT "supply_order_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."supply_batches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supply_order_items"
    ADD CONSTRAINT "supply_order_items_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supply_order_items"
    ADD CONSTRAINT "supply_order_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."staff_order_requests"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."vendor_earnings"
    ADD CONSTRAINT "vendor_earnings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."vendor_earnings"
    ADD CONSTRAINT "vendor_earnings_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id");



ALTER TABLE ONLY "public"."vendor_earnings"
    ADD CONSTRAINT "vendor_earnings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."vendor_earnings"
    ADD CONSTRAINT "vendor_earnings_wallet_transaction_id_fkey" FOREIGN KEY ("wallet_transaction_id") REFERENCES "public"."wallet_transactions"("id");



ALTER TABLE ONLY "public"."vendor_listing_changes"
    ADD CONSTRAINT "vendor_listing_changes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."essentials_catalog"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_listing_changes"
    ADD CONSTRAINT "vendor_listing_changes_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vendor_listing_changes"
    ADD CONSTRAINT "vendor_listing_changes_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_order_fulfilment"
    ADD CONSTRAINT "vendor_order_fulfilment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_order_fulfilment"
    ADD CONSTRAINT "vendor_order_fulfilment_ready_by_fkey" FOREIGN KEY ("ready_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vendor_order_fulfilment"
    ADD CONSTRAINT "vendor_order_fulfilment_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_zones"
    ADD CONSTRAINT "vendor_zones_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "public"."delivery_hubs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_zones"
    ADD CONSTRAINT "vendor_zones_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_zones"
    ADD CONSTRAINT "vendor_zones_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_owner_profile_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



CREATE POLICY "addresses_self" ON "public"."customer_addresses" USING ((("user_id" = "auth"."uid"()) OR ("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id"))));



CREATE POLICY "admin read templates" ON "public"."notification_templates" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'user_role'::"text") = 'admin'::"text"));



CREATE POLICY "admin write templates" ON "public"."notification_templates" FOR UPDATE TO "authenticated" USING ((("auth"."jwt"() ->> 'user_role'::"text") = 'admin'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'user_role'::"text") = 'admin'::"text"));



ALTER TABLE "public"."admin_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_notes_admin" ON "public"."admin_notes" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "admin_notes_hub_op_read" ON "public"."admin_notes" FOR SELECT USING ((("target_tab" = 'hub'::"text") AND "public"."has_branch_access"("branch_id") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'customer'::"text") AND ("p"."assigned_hub_id" IS NOT NULL))))));



CREATE POLICY "admin_notes_read" ON "public"."admin_notes" FOR SELECT USING (("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id")));



ALTER TABLE "public"."app_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_settings_admin_update" ON "public"."app_settings" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "app_settings_public_read" ON "public"."app_settings" FOR SELECT USING (true);



ALTER TABLE "public"."attendance_correction_days" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attendance_correction_days_admin" ON "public"."attendance_correction_days" FOR SELECT USING (("public"."is_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."attendance_correction_requests" "r"
  WHERE (("r"."id" = "attendance_correction_days"."request_id") AND "public"."has_branch_access"("r"."branch_id"))))));



CREATE POLICY "attendance_correction_days_self" ON "public"."attendance_correction_days" USING ((EXISTS ( SELECT 1
   FROM "public"."attendance_correction_requests" "r"
  WHERE (("r"."id" = "attendance_correction_days"."request_id") AND ("r"."staff_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."attendance_correction_requests" "r"
  WHERE (("r"."id" = "attendance_correction_days"."request_id") AND ("r"."staff_id" = "auth"."uid"()) AND ("r"."status" = 'pending'::"text")))));



ALTER TABLE "public"."attendance_correction_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attendance_correction_requests_admin" ON "public"."attendance_correction_requests" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "attendance_correction_requests_self_insert" ON "public"."attendance_correction_requests" FOR INSERT WITH CHECK ((("staff_id" = "auth"."uid"()) AND ("status" = 'pending'::"text")));



CREATE POLICY "attendance_correction_requests_self_read" ON "public"."attendance_correction_requests" FOR SELECT USING (("staff_id" = "auth"."uid"()));



CREATE POLICY "attendance_self" ON "public"."staff_attendance" USING ((("staff_id" = "auth"."uid"()) OR ("public"."is_admin"() AND "public"."has_branch_access"("branch_id")))) WITH CHECK ((("public"."is_admin"() AND "public"."has_branch_access"("branch_id")) OR (("staff_id" = "auth"."uid"()) AND ("date" >= ((("now"() AT TIME ZONE 'Asia/Kolkata'::"text"))::"date" - 7)) AND ("date" <= ((("now"() AT TIME ZONE 'Asia/Kolkata'::"text"))::"date" + 1)))));



ALTER TABLE "public"."banners" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "banners_admin_write" ON "public"."banners" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "banners_read_all" ON "public"."banners" FOR SELECT USING (true);



ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "branches_admin_write" ON "public"."branches" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "branches_read_all" ON "public"."branches" FOR SELECT USING (true);



ALTER TABLE "public"."business_expenses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "business_expenses_admin" ON "public"."business_expenses" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "cancelled_days_self" ON "public"."cancelled_subscription_days" USING ((("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id")) OR (EXISTS ( SELECT 1
   FROM "public"."user_subscriptions" "us"
  WHERE (("us"."id" = "cancelled_subscription_days"."subscription_id") AND ("us"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."cancelled_subscription_days" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_addresses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_addresses_hub_op_select" ON "public"."customer_addresses" FOR SELECT USING ((("hub_id" IS NOT NULL) AND ("hub_id" = (("auth"."jwt"() ->> 'assigned_hub_id'::"text"))::integer)));



ALTER TABLE "public"."delivery_cycles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "delivery_cycles_admin_write" ON "public"."delivery_cycles" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "delivery_cycles_read_all" ON "public"."delivery_cycles" FOR SELECT USING (true);



ALTER TABLE "public"."delivery_hubs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "delivery_hubs_admin_write" ON "public"."delivery_hubs" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "delivery_hubs_read_all" ON "public"."delivery_hubs" FOR SELECT USING (true);



ALTER TABLE "public"."delivery_zones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "delivery_zones_admin_write" ON "public"."delivery_zones" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "delivery_zones_read_all" ON "public"."delivery_zones" FOR SELECT USING (true);



ALTER TABLE "public"."essentials_catalog" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "essentials_catalog_admin_write" ON "public"."essentials_catalog" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "essentials_catalog_read_all" ON "public"."essentials_catalog" FOR SELECT USING (true);



CREATE POLICY "essentials_vendor_scope" ON "public"."essentials_catalog" AS RESTRICTIVE FOR SELECT USING ((("vendor_id" IS NULL) OR "public"."is_staff_or_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."vendors" "v"
  WHERE (("v"."id" = "essentials_catalog"."vendor_id") AND ("v"."owner_user_id" = "auth"."uid"())))) OR (("listing_status" = 'approved'::"text") AND ("vendor_id" IN ( SELECT "f"."vendor_id"
   FROM "public"."vendor_ids_visible_to_me"() "f"("vendor_id"))))));



CREATE POLICY "essentials_vendor_write" ON "public"."essentials_catalog" USING ((("vendor_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."vendors" "v"
  WHERE (("v"."id" = "essentials_catalog"."vendor_id") AND ("v"."owner_user_id" = "auth"."uid"()) AND ("v"."status" = 'approved'::"text")))))) WITH CHECK ((("vendor_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."vendors" "v"
  WHERE (("v"."id" = "essentials_catalog"."vendor_id") AND ("v"."owner_user_id" = "auth"."uid"()) AND ("v"."status" = 'approved'::"text"))))));



ALTER TABLE "public"."expense_claims" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expense_claims_self" ON "public"."expense_claims" USING ((("staff_id" = "auth"."uid"()) OR ("public"."is_admin"() AND "public"."has_branch_access"("branch_id")))) WITH CHECK ((("public"."is_admin"() AND "public"."has_branch_access"("branch_id")) OR (("staff_id" = "auth"."uid"()) AND ("status" = 'Pending'::"text") AND "public"."is_staff_or_admin"())));



ALTER TABLE "public"."feature_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feature_flags_admin" ON "public"."feature_flags" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "feature_flags_read" ON "public"."feature_flags" FOR SELECT USING (true);



CREATE POLICY "feedback_self" ON "public"."app_feedback" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("public"."is_staff_or_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "app_feedback"."user_id") AND "public"."has_branch_access"("p"."branch_id")))))));



CREATE POLICY "feedback_self_insert" ON "public"."app_feedback" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "idempotency_admin" ON "public"."idempotency_keys" FOR SELECT USING ("public"."is_super_admin"());



ALTER TABLE "public"."idempotency_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kitchen_push_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kitchen_push_log_admin" ON "public"."kitchen_push_log" FOR SELECT USING ("public"."is_super_admin"());



CREATE POLICY "kitchen_push_log_driver" ON "public"."kitchen_push_log" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."delivery_hubs" "h"
  WHERE ("h"."driver_user_id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM "public"."delivery_zones" "z"
  WHERE ("z"."driver_user_id" = "auth"."uid"())))));



CREATE POLICY "kitchen_push_log_staff" ON "public"."kitchen_push_log" FOR SELECT USING ("public"."is_staff_or_admin"());



CREATE POLICY "leave_self" ON "public"."staff_leaves" USING ((("staff_id" = "auth"."uid"()) OR ("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))));



ALTER TABLE "public"."loyalty_redemptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_redemptions_admin" ON "public"."loyalty_redemptions" USING ("public"."is_admin"());



CREATE POLICY "loyalty_redemptions_self" ON "public"."loyalty_redemptions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "manifest_log_admin" ON "public"."manifest_run_log" FOR SELECT USING ("public"."is_super_admin"());



ALTER TABLE "public"."manifest_run_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."menu_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "menu_items_admin_write" ON "public"."menu_items" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "menu_items_read_all" ON "public"."menu_items" FOR SELECT USING (true);



ALTER TABLE "public"."notification_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_item_ratings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_item_ratings_read" ON "public"."order_item_ratings" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_staff_or_admin"()));



ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_items_hub_op_select" ON "public"."order_items" FOR SELECT USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'customer'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_items"."order_id") AND ("o"."hub_id" IS NOT NULL) AND ("o"."hub_id" = (("auth"."jwt"() ->> 'assigned_hub_id'::"text"))::integer))))));



CREATE POLICY "order_items_insert" ON "public"."order_items" FOR INSERT WITH CHECK (("public"."is_staff_or_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_items"."order_id") AND ("o"."user_id" = "auth"."uid"()))))));



CREATE POLICY "order_items_self" ON "public"."order_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_items"."order_id") AND (("o"."user_id" = "auth"."uid"()) OR ("public"."is_staff_or_admin"() AND "public"."has_branch_access"("o"."branch_id")))))));



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_hub_op_select" ON "public"."orders" FOR SELECT USING (((("auth"."jwt"() ->> 'user_role'::"text") = 'customer'::"text") AND ("hub_id" IS NOT NULL) AND ("hub_id" = (("auth"."jwt"() ->> 'assigned_hub_id'::"text"))::integer)));



CREATE POLICY "orders_hub_operator_update" ON "public"."orders" FOR UPDATE USING (("hub_id" = (("auth"."jwt"() ->> 'assigned_hub_id'::"text"))::integer)) WITH CHECK ((("hub_id" = (("auth"."jwt"() ->> 'assigned_hub_id'::"text"))::integer) AND ("status" = ANY (ARRAY['Pending'::"text", 'Confirmed'::"text", 'Preparing'::"text", 'Ready'::"text", 'Packed'::"text", 'Dispatched'::"text", 'Received at Hub'::"text", 'On the Way'::"text", 'Delivered'::"text", 'Cancelled'::"text", 'Failed'::"text"]))));



CREATE POLICY "orders_self" ON "public"."orders" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id"))));



CREATE POLICY "orders_self_insert" ON "public"."orders" FOR INSERT WITH CHECK (((("user_id" = "auth"."uid"()) AND ("status" = 'Pending'::"text")) OR ("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id"))));



CREATE POLICY "orders_staff_update" ON "public"."orders" FOR UPDATE USING (("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "own rows insert" ON "public"."order_item_ratings" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "pending_topups_admin" ON "public"."pending_wallet_topups" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("public"."is_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "pending_wallet_topups"."user_id") AND "public"."has_branch_access"("p"."branch_id")))))));



CREATE POLICY "pending_topups_self" ON "public"."pending_wallet_topups" FOR SELECT USING (("public"."is_admin"() OR ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."pending_wallet_topups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_admin_all" ON "public"."profiles" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "profiles_auth_hook_bypass" ON "public"."profiles" FOR SELECT TO "supabase_auth_admin" USING (true);



CREATE POLICY "profiles_self_insert" ON "public"."profiles" FOR INSERT WITH CHECK ((("id" = "auth"."uid"()) OR ("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))));



CREATE POLICY "profiles_self_read" ON "public"."profiles" FOR SELECT USING ((("id" = "auth"."uid"()) OR ("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id"))));



CREATE POLICY "profiles_self_update" ON "public"."profiles" FOR UPDATE USING ((("id" = "auth"."uid"()) OR ("public"."is_admin"() AND "public"."has_branch_access"("branch_id")))) WITH CHECK ((("id" = "auth"."uid"()) OR ("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))));



ALTER TABLE "public"."push_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_logs_admin_read" ON "public"."push_logs" FOR SELECT USING ("public"."is_admin"());



ALTER TABLE "public"."push_notification_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_tokens_self" ON "public"."push_notification_tokens" USING ((("user_id" = "auth"."uid"()) OR ("public"."is_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "push_notification_tokens"."user_id") AND "public"."has_branch_access"("p"."branch_id")))))));



ALTER TABLE "public"."referral_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "referral_settings_admin" ON "public"."referral_settings" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "referral_settings_read" ON "public"."referral_settings" FOR SELECT USING (true);



ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "referrals_self" ON "public"."referrals" FOR SELECT USING ((("referrer_id" = "auth"."uid"()) OR ("referee_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "salary_admin_all" ON "public"."staff_salary" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "salary_self" ON "public"."staff_salary" FOR SELECT USING ((("staff_id" = "auth"."uid"()) OR ("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))));



ALTER TABLE "public"."seed_360_registry" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seed_360_run" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seed_360_wallet_snapshot" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "slabs_admin_write" ON "public"."subscription_discount_slabs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "slabs_read_all" ON "public"."subscription_discount_slabs" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."staff_attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_leaves" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_order_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_order_requests_admin" ON "public"."staff_order_requests" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "staff_order_requests_self_insert" ON "public"."staff_order_requests" FOR INSERT WITH CHECK ((("submitted_by" = "auth"."uid"()) AND "public"."is_staff_or_admin"()));



CREATE POLICY "staff_order_requests_self_read" ON "public"."staff_order_requests" FOR SELECT USING ((("submitted_by" = "auth"."uid"()) OR ("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))));



CREATE POLICY "staff_order_requests_staff" ON "public"."staff_order_requests" FOR SELECT USING (("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id")));



ALTER TABLE "public"."staff_salary" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_shifts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_shifts_admin" ON "public"."staff_shifts" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "staff_shifts_read" ON "public"."staff_shifts" FOR SELECT USING (("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id")));



ALTER TABLE "public"."store_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "store_config_admin" ON "public"."store_config" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "store_config_read" ON "public"."store_config" FOR SELECT USING (true);



ALTER TABLE "public"."subscription_discount_slabs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_plan_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscription_plan_items_admin_write" ON "public"."subscription_plan_items" USING (("public"."is_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."subscription_plans" "sp"
  WHERE (("sp"."id" = "subscription_plan_items"."plan_id") AND "public"."has_branch_access"("sp"."branch_id")))))) WITH CHECK (("public"."is_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."subscription_plans" "sp"
  WHERE (("sp"."id" = "subscription_plan_items"."plan_id") AND "public"."has_branch_access"("sp"."branch_id"))))));



CREATE POLICY "subscription_plan_items_read_all" ON "public"."subscription_plan_items" FOR SELECT USING (true);



ALTER TABLE "public"."subscription_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscription_plans_admin_write" ON "public"."subscription_plans" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "subscription_plans_read_all" ON "public"."subscription_plans" FOR SELECT TO "authenticated" USING (((NOT "is_custom") OR ("created_by" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."supply_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supply_batches_admin" ON "public"."supply_batches" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "supply_batches_staff" ON "public"."supply_batches" USING (("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id")));



ALTER TABLE "public"."supply_catalog" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supply_catalog_admin" ON "public"."supply_catalog" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "supply_catalog_staff_read" ON "public"."supply_catalog" FOR SELECT USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."supply_order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supply_order_items_admin" ON "public"."supply_order_items" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "supply_order_items_staff" ON "public"."supply_order_items" USING (("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "user_subs_self" ON "public"."user_subscriptions" USING ((("user_id" = "auth"."uid"()) OR ("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id"))));



ALTER TABLE "public"."user_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_earnings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendor_earnings_read" ON "public"."vendor_earnings" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."vendors" "v"
  WHERE (("v"."id" = "vendor_earnings"."vendor_id") AND ("v"."owner_user_id" = "auth"."uid"())))) OR "public"."is_admin"()));



ALTER TABLE "public"."vendor_listing_changes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendor_listing_changes_read" ON "public"."vendor_listing_changes" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."vendors" "v"
  WHERE (("v"."id" = "vendor_listing_changes"."vendor_id") AND ("v"."owner_user_id" = "auth"."uid"())))) OR "public"."is_admin"()));



ALTER TABLE "public"."vendor_order_fulfilment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_zones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendor_zones_admin_write" ON "public"."vendor_zones" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "vendor_zones_read" ON "public"."vendor_zones" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."vendors" "v"
  WHERE (("v"."id" = "vendor_zones"."vendor_id") AND ("v"."owner_user_id" = "auth"."uid"())))) OR "public"."is_staff_or_admin"()));



ALTER TABLE "public"."vendors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendors_admin_all" ON "public"."vendors" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "vendors_owner_read" ON "public"."vendors" FOR SELECT USING ((("owner_user_id" = "auth"."uid"()) OR ("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id"))));



CREATE POLICY "vendors_owner_update" ON "public"."vendors" FOR UPDATE USING ((("owner_user_id" = "auth"."uid"()) AND ("status" = ANY (ARRAY['invited'::"text", 'submitted'::"text"])))) WITH CHECK ((("owner_user_id" = "auth"."uid"()) AND ("status" = ANY (ARRAY['invited'::"text", 'submitted'::"text"]))));



CREATE POLICY "vof_vendor_rw" ON "public"."vendor_order_fulfilment" USING (((EXISTS ( SELECT 1
   FROM "public"."vendors" "v"
  WHERE (("v"."id" = "vendor_order_fulfilment"."vendor_id") AND ("v"."owner_user_id" = "auth"."uid"())))) OR "public"."is_staff_or_admin"())) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."vendors" "v"
  WHERE (("v"."id" = "vendor_order_fulfilment"."vendor_id") AND ("v"."owner_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."wallet_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallet_tx_no_writes" ON "public"."wallet_transactions" FOR INSERT WITH CHECK (("public"."is_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "wallet_transactions"."user_id") AND "public"."has_branch_access"("p"."branch_id"))))));



CREATE POLICY "wallet_tx_self" ON "public"."wallet_transactions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("public"."is_staff_or_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "wallet_transactions"."user_id") AND "public"."has_branch_access"("p"."branch_id")))))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."admin_notes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."kitchen_push_log";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."orders";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";














































































































































































GRANT ALL ON FUNCTION "public"."_hub_commission_for_period"("p_hub_id" integer, "p_start" "date", "p_next_start" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_kitchen_get_secret"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_kitchen_get_secret"("p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_undelivered_order_ids"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_undelivered_order_ids"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_or_merge_supply_order_item"("p_name" "text", "p_qty" integer, "p_category" "text", "p_request_id" bigint, "p_added_by" "uuid", "p_branch_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_or_merge_supply_order_item"("p_name" "text", "p_qty" integer, "p_category" "text", "p_request_id" bigint, "p_added_by" "uuid", "p_branch_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_or_merge_supply_order_item"("p_name" "text", "p_qty" integer, "p_category" "text", "p_request_id" bigint, "p_added_by" "uuid", "p_branch_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_cancel_order_atomic"("p_order_id" bigint, "p_refund_amount" numeric, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_cancel_order_atomic"("p_order_id" bigint, "p_refund_amount" numeric, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_cancel_order_atomic"("p_order_id" bigint, "p_refund_amount" numeric, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_cancel_subscription_atomic"("p_subscription_id" bigint, "p_refund_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_cancel_subscription_atomic"("p_subscription_id" bigint, "p_refund_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_cancel_subscription_atomic"("p_subscription_id" bigint, "p_refund_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_create_essential"("p_name" "text", "p_price" numeric, "p_cycle_id" integer, "p_branch_id" integer, "p_unit" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_create_essential"("p_name" "text", "p_price" numeric, "p_cycle_id" integer, "p_branch_id" integer, "p_unit" "text", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_essential"("p_name" "text", "p_price" numeric, "p_cycle_id" integer, "p_branch_id" integer, "p_unit" "text", "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_create_menu_block"("p_name" "text", "p_price" numeric, "p_branch_id" integer, "p_unit" "text", "p_base_qty" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_create_menu_block"("p_name" "text", "p_price" numeric, "p_branch_id" integer, "p_unit" "text", "p_base_qty" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_menu_block"("p_name" "text", "p_price" numeric, "p_branch_id" integer, "p_unit" "text", "p_base_qty" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_issue_referral_month_bonus"("p_referral_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_issue_referral_month_bonus"("p_referral_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_issue_referral_month_bonus"("p_referral_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_onboard_vendor"("p_user_id" "uuid", "p_business_name" "text", "p_contact_phone" "text", "p_selling_model" "text", "p_supply_mode" "text", "p_commission_percent" numeric, "p_branch_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_onboard_vendor"("p_user_id" "uuid", "p_business_name" "text", "p_contact_phone" "text", "p_selling_model" "text", "p_supply_mode" "text", "p_commission_percent" numeric, "p_branch_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_onboard_vendor"("p_user_id" "uuid", "p_business_name" "text", "p_contact_phone" "text", "p_selling_model" "text", "p_supply_mode" "text", "p_commission_percent" numeric, "p_branch_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remove_menu_item"("p_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remove_menu_item"("p_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remove_menu_item"("p_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_rename_menu_block"("p_old" "text", "p_new" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_rename_menu_block"("p_old" "text", "p_new" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_rename_menu_block"("p_old" "text", "p_new" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_review_listing"("p_item_id" integer, "p_approve" boolean, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_review_listing"("p_item_id" integer, "p_approve" boolean, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_review_listing"("p_item_id" integer, "p_approve" boolean, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_review_listing_change"("p_change_id" bigint, "p_approve" boolean, "p_reason" "text", "p_photo_promoted" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_review_listing_change"("p_change_id" bigint, "p_approve" boolean, "p_reason" "text", "p_photo_promoted" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_review_listing_change"("p_change_id" bigint, "p_approve" boolean, "p_reason" "text", "p_photo_promoted" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_menu_block_unit"("p_id" integer, "p_unit" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_menu_block_unit"("p_id" integer, "p_unit" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_menu_block_unit"("p_id" integer, "p_unit" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_vendor_status"("p_vendor_id" bigint, "p_status" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_vendor_status"("p_vendor_id" bigint, "p_status" "text", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_vendor_status"("p_vendor_id" bigint, "p_status" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_vendor_terms"("p_vendor_id" bigint, "p_commission_percent" numeric, "p_selling_model" "text", "p_supply_mode" "text", "p_return_policy" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_vendor_terms"("p_vendor_id" bigint, "p_commission_percent" numeric, "p_selling_model" "text", "p_supply_mode" "text", "p_return_policy" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_vendor_terms"("p_vendor_id" bigint, "p_commission_percent" numeric, "p_selling_model" "text", "p_supply_mode" "text", "p_return_policy" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_undelivered_order_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_undelivered_order_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_undelivered_order_ids"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."advance_orders_status"("p_order_ids" bigint[], "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."advance_orders_status"("p_order_ids" bigint[], "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."advance_orders_status"("p_order_ids" bigint[], "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."alert_cron_failures"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."alert_cron_failures"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."alert_missing_kitchen_pushes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."alert_missing_kitchen_pushes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."alert_undelivered_batch"("p_cycle_id" integer, "p_push_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."alert_undelivered_batch"("p_cycle_id" integer, "p_push_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."approve_attendance_correction"("p_request_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_attendance_correction"("p_request_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_attendance_correction"("p_request_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_addresses_to_hub"("p_hub_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_addresses_to_hub"("p_hub_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_addresses_to_hub"("p_hub_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_hub_operator"("p_hub_id" bigint, "p_new_user_id" "uuid", "p_old_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_hub_operator"("p_hub_id" bigint, "p_new_user_id" "uuid", "p_old_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_hub_operator"("p_hub_id" bigint, "p_new_user_id" "uuid", "p_old_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_hub_to_address_ids"("p_hub_id" integer, "p_address_ids" integer[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_hub_to_address_ids"("p_hub_id" integer, "p_address_ids" integer[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_hub_to_address_ids"("p_hub_id" integer, "p_address_ids" integer[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."auth_user_id_by_phone"("p_phone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auth_user_id_by_phone"("p_phone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."backfill_dispatch_manifest"("p_start_date" "date", "p_end_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."backfill_dispatch_manifest"("p_start_date" "date", "p_end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."backfill_dispatch_manifest"("p_start_date" "date", "p_end_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."catalog_photo_writable"("p_bucket" "text", "p_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."catalog_photo_writable"("p_bucket" "text", "p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."catalog_photo_writable"("p_bucket" "text", "p_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_onboarding_atomic"("p_user_id" "uuid", "p_phone_number" "text", "p_full_name" "text", "p_label" "text", "p_address_line" "text", "p_landmark" "text", "p_city" "text", "p_pincode" "text", "p_latitude" numeric, "p_longitude" numeric, "p_zone_id" integer, "p_hub_id" integer, "p_is_serviceable" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_onboarding_atomic"("p_user_id" "uuid", "p_phone_number" "text", "p_full_name" "text", "p_label" "text", "p_address_line" "text", "p_landmark" "text", "p_city" "text", "p_pincode" "text", "p_latitude" numeric, "p_longitude" numeric, "p_zone_id" integer, "p_hub_id" integer, "p_is_serviceable" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_onboarding_atomic"("p_user_id" "uuid", "p_phone_number" "text", "p_full_name" "text", "p_label" "text", "p_address_line" "text", "p_landmark" "text", "p_city" "text", "p_pincode" "text", "p_latitude" numeric, "p_longitude" numeric, "p_zone_id" integer, "p_hub_id" integer, "p_is_serviceable" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_wallet_topup"("p_razorpay_order_id" "text", "p_razorpay_payment_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_wallet_topup"("p_razorpay_order_id" "text", "p_razorpay_payment_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_custom_plan"("p_cycle_id" integer, "p_items" "jsonb", "p_duration_days" integer, "p_plan_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_custom_plan"("p_cycle_id" integer, "p_items" "jsonb", "p_duration_days" integer, "p_plan_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_custom_plan"("p_cycle_id" integer, "p_items" "jsonb", "p_duration_days" integer, "p_plan_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_hub_commission_claim"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_hub_commission_claim"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_hub_commission_claim"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_vendor_payout_claim"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_vendor_payout_claim"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_vendor_payout_claim"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."credit_vendor_earnings_for_order"("p_order_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."credit_vendor_earnings_for_order"("p_order_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."decrement_wallet_balance_if_sufficient"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_reference_type" "text", "p_reference_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decrement_wallet_balance_if_sufficient"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_reference_type" "text", "p_reference_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."default_branch_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."default_branch_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."demote_employee"("target_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."demote_employee"("target_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."demote_employee"("target_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."derive_address_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."derive_address_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."derive_address_branch_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."derive_driver_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."derive_driver_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."derive_driver_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."derive_profile_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."derive_profile_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."derive_profile_branch_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."elevate_to_staff"("p_user_id" "uuid", "p_full_name" "text", "p_phone_number" "text", "p_designation" "text", "p_joining_date" "date", "p_shift_timing" "text", "p_assigned_hub_id" bigint, "p_monthly_salary" numeric, "p_benefits" "text", "p_joining_bonus" numeric, "p_branch_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."elevate_to_staff"("p_user_id" "uuid", "p_full_name" "text", "p_phone_number" "text", "p_designation" "text", "p_joining_date" "date", "p_shift_timing" "text", "p_assigned_hub_id" bigint, "p_monthly_salary" numeric, "p_benefits" "text", "p_joining_bonus" numeric, "p_branch_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."external_heartbeat"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."external_heartbeat"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_daily_manifest"("p_target_date" "date", "p_cycle_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_daily_manifest"("p_target_date" "date", "p_cycle_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_active_staff_batch"("p_branch_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_active_staff_batch"("p_branch_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_staff_batch"("p_branch_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_addresses_for_hub_assignment"("p_hub_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_addresses_for_hub_assignment"("p_hub_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_addresses_for_hub_assignment"("p_hub_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_hub_commission_summary"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_hub_commission_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_hub_commission_summary"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_hub_impact_addresses"("p_hub_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_hub_impact_addresses"("p_hub_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_hub_impact_addresses"("p_hub_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_job_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_job_health"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_job_health"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_kitchen_aggregate"("p_cycle_id" bigint, "p_dispatch_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_kitchen_aggregate"("p_cycle_id" bigint, "p_dispatch_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_kitchen_aggregate"("p_cycle_id" bigint, "p_dispatch_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_kitchen_aggregate"("p_cycle_id" bigint, "p_dispatch_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_server_time"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_server_time"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_server_time"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_first_order_referral_bonus"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_first_order_referral_bonus"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."has_branch_access"("row_branch_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."has_branch_access"("row_branch_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_branch_access"("row_branch_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."increment_loyalty_points"("p_user_id" "uuid", "p_points" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."increment_loyalty_points"("p_user_id" "uuid", "p_points" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_reference_type" "text", "p_reference_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_reference_type" "text", "p_reference_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_staff_or_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_staff_or_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_staff_or_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."jwt_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."jwt_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."jwt_branch_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."jwt_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."jwt_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."jwt_user_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_order_failed"("p_razorpay_order_id" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_order_failed"("p_razorpay_order_id" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_order_paid"("p_razorpay_order_id" "text", "p_razorpay_payment_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_order_paid"("p_razorpay_order_id" "text", "p_razorpay_payment_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."menu_block_usage"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."menu_block_usage"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."menu_block_usage"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mirror_staff_request_to_supply_items"() TO "anon";
GRANT ALL ON FUNCTION "public"."mirror_staff_request_to_supply_items"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mirror_staff_request_to_supply_items"() TO "service_role";



GRANT ALL ON TABLE "public"."vendors" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."vendors" TO "service_role";



GRANT UPDATE("business_name") ON TABLE "public"."vendors" TO "authenticated";



GRANT UPDATE("contact_phone") ON TABLE "public"."vendors" TO "authenticated";



GRANT UPDATE("gst_number") ON TABLE "public"."vendors" TO "authenticated";



GRANT UPDATE("fssai_number") ON TABLE "public"."vendors" TO "authenticated";



GRANT UPDATE("return_policy") ON TABLE "public"."vendors" TO "authenticated";



GRANT UPDATE("terms_accepted_at") ON TABLE "public"."vendors" TO "authenticated";



GRANT UPDATE("submitted_at") ON TABLE "public"."vendors" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."my_approved_vendor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_approved_vendor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_approved_vendor"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_order_states"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_order_states"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_order_states"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_admins_listing_submitted"("p_vendor_name" "text", "p_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_admins_listing_submitted"("p_vendor_name" "text", "p_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_attendance_regularization"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_attendance_regularization"() TO "service_role";



GRANT ALL ON FUNCTION "public"."orders_status_no_regress"() TO "anon";
GRANT ALL ON FUNCTION "public"."orders_status_no_regress"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."orders_status_no_regress"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."place_order_atomic"("p_user_id" "uuid", "p_status" "text", "p_order_type" "text", "p_delivery_method" "text", "p_hub_id" bigint, "p_payment_method" "text", "p_razorpay_order_id" "text", "p_delivery_address_id" bigint, "p_notes" "text", "p_branch_id" bigint, "p_groups" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."place_order_atomic"("p_user_id" "uuid", "p_status" "text", "p_order_type" "text", "p_delivery_method" "text", "p_hub_id" bigint, "p_payment_method" "text", "p_razorpay_order_id" "text", "p_delivery_address_id" bigint, "p_notes" "text", "p_branch_id" bigint, "p_groups" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."plan_discount_percent"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."plan_discount_percent"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."plan_discount_percent"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."point_in_polygon"("p_lat" double precision, "p_lng" double precision, "p_poly" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."point_in_polygon"("p_lat" double precision, "p_lng" double precision, "p_poly" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."point_in_polygon"("p_lat" double precision, "p_lng" double precision, "p_poly" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."print_supply_batch_atomic"("p_item_ids" integer[], "p_branch_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."print_supply_batch_atomic"("p_item_ids" integer[], "p_branch_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."print_supply_batch_atomic"("p_item_ids" integer[], "p_branch_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."prune_operational_logs"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prune_operational_logs"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."push_kitchen_summary"("p_cycle_id" integer, "p_target_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."push_kitchen_summary"("p_cycle_id" integer, "p_target_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."redeem_loyalty_points"("p_points" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."redeem_loyalty_points"("p_points" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."redeem_loyalty_points"("p_points" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reject_attendance_correction"("p_request_id" bigint, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_attendance_correction"("p_request_id" bigint, "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_attendance_correction"("p_request_id" bigint, "p_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_address_on_write"() TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_address_on_write"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_address_on_write"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_address_serviceability"("p_lat" double precision, "p_lng" double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_address_serviceability"("p_lat" double precision, "p_lng" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_address_serviceability"("p_lat" double precision, "p_lng" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_attendance_correction_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_attendance_correction_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_attendance_correction_branch_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_cancelled_day_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_cancelled_day_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_cancelled_day_branch_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_default_address"("p_address_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_default_address"("p_address_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_default_address"("p_address_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_employee_designation"("target_id" "uuid", "new_designation" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_employee_designation"("target_id" "uuid", "new_designation" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_employee_designation"("target_id" "uuid", "new_designation" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_expense_claim_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_expense_claim_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_expense_claim_branch_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_staff_order_request_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_staff_order_request_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_staff_order_request_branch_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_profile_phone_on_auth_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_profile_phone_on_auth_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_profile_phone_on_auth_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tag_wallet_debit_to_order"("p_user_id" "uuid", "p_order_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tag_wallet_debit_to_order"("p_user_id" "uuid", "p_order_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_credit_vendor_earnings"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_credit_vendor_earnings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_credit_vendor_earnings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_vendor_payout_paid"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_vendor_payout_paid"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_vendor_payout_paid"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trigger_kitchen_cutoff_pushes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trigger_kitchen_cutoff_pushes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_employee_profile"("target_id" "uuid", "updates" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_employee_profile"("target_id" "uuid", "updates" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_employee_profile"("target_id" "uuid", "updates" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."vendor_create_draft_listing"("p_name" "text", "p_price" numeric, "p_unit" "text", "p_cycle_id" integer, "p_description" "text", "p_daily_cap" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vendor_create_draft_listing"("p_name" "text", "p_price" numeric, "p_unit" "text", "p_cycle_id" integer, "p_description" "text", "p_daily_cap" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vendor_create_draft_listing"("p_name" "text", "p_price" numeric, "p_unit" "text", "p_cycle_id" integer, "p_description" "text", "p_daily_cap" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."vendor_ids_for_address"("p_address_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vendor_ids_for_address"("p_address_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vendor_ids_for_address"("p_address_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."vendor_ids_visible_to_me"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vendor_ids_visible_to_me"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."vendor_ids_visible_to_me"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vendor_listing_edit_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."vendor_listing_edit_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."vendor_listing_edit_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."vendor_mark_order_ready"("p_order_id" bigint, "p_ready" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vendor_mark_order_ready"("p_order_id" bigint, "p_ready" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vendor_mark_order_ready"("p_order_id" bigint, "p_ready" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."vendor_orders"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vendor_orders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."vendor_orders"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."vendor_propose_listing_change"("p_item_id" integer, "p_proposed" "jsonb", "p_photo_pending" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vendor_propose_listing_change"("p_item_id" integer, "p_proposed" "jsonb", "p_photo_pending" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vendor_propose_listing_change"("p_item_id" integer, "p_proposed" "jsonb", "p_photo_pending" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."vendor_submit_listings"("p_item_ids" integer[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vendor_submit_listings"("p_item_ids" integer[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vendor_submit_listings"("p_item_ids" integer[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."vendor_submit_registration"("p_business_name" "text", "p_contact_phone" "text", "p_gst_number" "text", "p_fssai_number" "text", "p_return_policy" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vendor_submit_registration"("p_business_name" "text", "p_contact_phone" "text", "p_gst_number" "text", "p_fssai_number" "text", "p_return_policy" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vendor_submit_registration"("p_business_name" "text", "p_contact_phone" "text", "p_gst_number" "text", "p_fssai_number" "text", "p_return_policy" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."vendor_supply_list"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vendor_supply_list"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."vendor_supply_list"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."vendor_used_quantities"("p_item_ids" bigint[], "p_dispatch_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vendor_used_quantities"("p_item_ids" bigint[], "p_dispatch_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vendor_used_quantities"("p_item_ids" bigint[], "p_dispatch_date" "date") TO "service_role";
























GRANT ALL ON TABLE "public"."admin_notes" TO "anon";
GRANT ALL ON TABLE "public"."admin_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_notes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."admin_notes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."admin_notes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."admin_notes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."app_config" TO "anon";
GRANT ALL ON TABLE "public"."app_config" TO "authenticated";
GRANT ALL ON TABLE "public"."app_config" TO "service_role";



GRANT ALL ON TABLE "public"."app_feedback" TO "anon";
GRANT ALL ON TABLE "public"."app_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."app_feedback" TO "service_role";



GRANT ALL ON SEQUENCE "public"."app_feedback_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."app_feedback_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."app_feedback_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_correction_days" TO "anon";
GRANT ALL ON TABLE "public"."attendance_correction_days" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_correction_days" TO "service_role";



GRANT ALL ON SEQUENCE "public"."attendance_correction_days_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."attendance_correction_days_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."attendance_correction_days_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_correction_requests" TO "anon";
GRANT ALL ON TABLE "public"."attendance_correction_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_correction_requests" TO "service_role";



GRANT ALL ON SEQUENCE "public"."attendance_correction_requests_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."attendance_correction_requests_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."attendance_correction_requests_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."banners" TO "anon";
GRANT ALL ON TABLE "public"."banners" TO "authenticated";
GRANT ALL ON TABLE "public"."banners" TO "service_role";



GRANT ALL ON SEQUENCE "public"."banners_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."banners_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."banners_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."branches" TO "anon";
GRANT ALL ON TABLE "public"."branches" TO "authenticated";
GRANT ALL ON TABLE "public"."branches" TO "service_role";



GRANT ALL ON SEQUENCE "public"."branches_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."branches_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."branches_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."business_expenses" TO "anon";
GRANT ALL ON TABLE "public"."business_expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."business_expenses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."business_expenses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."business_expenses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."business_expenses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cancelled_subscription_days" TO "anon";
GRANT ALL ON TABLE "public"."cancelled_subscription_days" TO "authenticated";
GRANT ALL ON TABLE "public"."cancelled_subscription_days" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cancelled_subscription_days_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cancelled_subscription_days_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cancelled_subscription_days_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."customer_addresses" TO "anon";
GRANT ALL ON TABLE "public"."customer_addresses" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_addresses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."customer_addresses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."customer_addresses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."customer_addresses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."delivery_cycles" TO "anon";
GRANT ALL ON TABLE "public"."delivery_cycles" TO "authenticated";
GRANT ALL ON TABLE "public"."delivery_cycles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."delivery_cycles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."delivery_cycles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."delivery_cycles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."delivery_hubs" TO "anon";
GRANT ALL ON TABLE "public"."delivery_hubs" TO "authenticated";
GRANT ALL ON TABLE "public"."delivery_hubs" TO "service_role";
GRANT SELECT ON TABLE "public"."delivery_hubs" TO "supabase_auth_admin";



GRANT ALL ON SEQUENCE "public"."delivery_hubs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."delivery_hubs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."delivery_hubs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."delivery_zones" TO "anon";
GRANT ALL ON TABLE "public"."delivery_zones" TO "authenticated";
GRANT ALL ON TABLE "public"."delivery_zones" TO "service_role";
GRANT SELECT ON TABLE "public"."delivery_zones" TO "supabase_auth_admin";



GRANT ALL ON SEQUENCE "public"."delivery_zones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."delivery_zones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."delivery_zones_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."employee_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."employee_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."employee_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."essentials_catalog" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."essentials_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."essentials_catalog" TO "service_role";



GRANT UPDATE("cycle_id") ON TABLE "public"."essentials_catalog" TO "authenticated";



GRANT UPDATE("name") ON TABLE "public"."essentials_catalog" TO "authenticated";



GRANT UPDATE("price") ON TABLE "public"."essentials_catalog" TO "authenticated";



GRANT UPDATE("unit") ON TABLE "public"."essentials_catalog" TO "authenticated";



GRANT UPDATE("is_active") ON TABLE "public"."essentials_catalog" TO "authenticated";



GRANT UPDATE("sort_order") ON TABLE "public"."essentials_catalog" TO "authenticated";



GRANT UPDATE("daily_cap") ON TABLE "public"."essentials_catalog" TO "authenticated";



GRANT UPDATE("image_path") ON TABLE "public"."essentials_catalog" TO "authenticated";



GRANT UPDATE("image_updated_at") ON TABLE "public"."essentials_catalog" TO "authenticated";



GRANT UPDATE("description") ON TABLE "public"."essentials_catalog" TO "authenticated";



GRANT UPDATE("plan_eligible") ON TABLE "public"."essentials_catalog" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."essentials_catalog_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."essentials_catalog_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."essentials_catalog_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."expense_claims" TO "anon";
GRANT ALL ON TABLE "public"."expense_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."expense_claims" TO "service_role";



GRANT ALL ON SEQUENCE "public"."expense_claims_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."expense_claims_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."expense_claims_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."feature_flags" TO "anon";
GRANT ALL ON TABLE "public"."feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_flags" TO "service_role";



GRANT ALL ON SEQUENCE "public"."feature_flags_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."feature_flags_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."feature_flags_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."idempotency_keys" TO "anon";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "service_role";



GRANT ALL ON TABLE "public"."kitchen_push_log" TO "anon";
GRANT ALL ON TABLE "public"."kitchen_push_log" TO "authenticated";
GRANT ALL ON TABLE "public"."kitchen_push_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kitchen_push_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kitchen_push_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kitchen_push_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_redemptions" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_redemptions" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_redemptions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."loyalty_redemptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."loyalty_redemptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."loyalty_redemptions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."manifest_run_log" TO "anon";
GRANT ALL ON TABLE "public"."manifest_run_log" TO "authenticated";
GRANT ALL ON TABLE "public"."manifest_run_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."manifest_run_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."manifest_run_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."manifest_run_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."menu_items" TO "anon";
GRANT ALL ON TABLE "public"."menu_items" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_items" TO "service_role";



GRANT UPDATE("plan_eligible") ON TABLE "public"."menu_items" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."menu_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."menu_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."menu_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notification_templates" TO "anon";
GRANT ALL ON TABLE "public"."notification_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_templates" TO "service_role";



GRANT ALL ON TABLE "public"."order_item_ratings" TO "anon";
GRANT ALL ON TABLE "public"."order_item_ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."order_item_ratings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."order_item_ratings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_item_ratings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_item_ratings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."order_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT UPDATE("status") ON TABLE "public"."orders" TO "authenticated";



GRANT UPDATE("updated_at") ON TABLE "public"."orders" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pending_wallet_topups" TO "anon";
GRANT ALL ON TABLE "public"."pending_wallet_topups" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_wallet_topups" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "supabase_auth_admin";



GRANT INSERT("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("phone_number"),UPDATE("phone_number") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("full_name"),UPDATE("full_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."push_logs" TO "anon";
GRANT ALL ON TABLE "public"."push_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."push_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."push_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."push_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."push_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."push_notification_tokens" TO "anon";
GRANT ALL ON TABLE "public"."push_notification_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."push_notification_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."push_notification_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."push_notification_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."push_notification_tokens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."referral_settings" TO "anon";
GRANT ALL ON TABLE "public"."referral_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_settings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."referral_settings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."referral_settings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."referral_settings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."referrals" TO "anon";
GRANT ALL ON TABLE "public"."referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."referrals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."referrals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."referrals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."referrals_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."seed_360_registry" TO "anon";
GRANT ALL ON TABLE "public"."seed_360_registry" TO "authenticated";
GRANT ALL ON TABLE "public"."seed_360_registry" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seed_360_registry_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."seed_360_registry_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seed_360_registry_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."seed_360_run" TO "anon";
GRANT ALL ON TABLE "public"."seed_360_run" TO "authenticated";
GRANT ALL ON TABLE "public"."seed_360_run" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seed_360_run_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."seed_360_run_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seed_360_run_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."seed_360_wallet_snapshot" TO "anon";
GRANT ALL ON TABLE "public"."seed_360_wallet_snapshot" TO "authenticated";
GRANT ALL ON TABLE "public"."seed_360_wallet_snapshot" TO "service_role";



GRANT ALL ON TABLE "public"."staff_attendance" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."staff_attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_attendance" TO "service_role";



GRANT UPDATE("clock_out_time") ON TABLE "public"."staff_attendance" TO "authenticated";



GRANT UPDATE("clock_out_lat") ON TABLE "public"."staff_attendance" TO "authenticated";



GRANT UPDATE("clock_out_lng") ON TABLE "public"."staff_attendance" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."staff_attendance_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."staff_attendance_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."staff_attendance_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."staff_leaves" TO "anon";
GRANT ALL ON TABLE "public"."staff_leaves" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_leaves" TO "service_role";



GRANT ALL ON SEQUENCE "public"."staff_leaves_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."staff_leaves_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."staff_leaves_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."staff_order_requests" TO "anon";
GRANT ALL ON TABLE "public"."staff_order_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_order_requests" TO "service_role";



GRANT ALL ON SEQUENCE "public"."staff_order_requests_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."staff_order_requests_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."staff_order_requests_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."staff_salary" TO "anon";
GRANT ALL ON TABLE "public"."staff_salary" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_salary" TO "service_role";



GRANT ALL ON SEQUENCE "public"."staff_salary_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."staff_salary_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."staff_salary_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."staff_shifts" TO "anon";
GRANT ALL ON TABLE "public"."staff_shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_shifts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."staff_shifts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."staff_shifts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."staff_shifts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."store_config" TO "anon";
GRANT ALL ON TABLE "public"."store_config" TO "authenticated";
GRANT ALL ON TABLE "public"."store_config" TO "service_role";



GRANT ALL ON SEQUENCE "public"."store_config_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."store_config_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."store_config_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_discount_slabs" TO "anon";
GRANT ALL ON TABLE "public"."subscription_discount_slabs" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_discount_slabs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subscription_discount_slabs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subscription_discount_slabs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subscription_discount_slabs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_plan_items" TO "anon";
GRANT ALL ON TABLE "public"."subscription_plan_items" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_plan_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subscription_plan_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subscription_plan_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subscription_plan_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_plans" TO "anon";
GRANT ALL ON TABLE "public"."subscription_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_plans" TO "service_role";



GRANT UPDATE("image_path") ON TABLE "public"."subscription_plans" TO "authenticated";



GRANT UPDATE("image_updated_at") ON TABLE "public"."subscription_plans" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."subscription_plans_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subscription_plans_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subscription_plans_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."supply_batches" TO "anon";
GRANT ALL ON TABLE "public"."supply_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."supply_batches" TO "service_role";



GRANT ALL ON SEQUENCE "public"."supply_batches_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."supply_batches_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."supply_batches_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."supply_catalog" TO "anon";
GRANT ALL ON TABLE "public"."supply_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."supply_catalog" TO "service_role";



GRANT ALL ON TABLE "public"."supply_order_items" TO "anon";
GRANT ALL ON TABLE "public"."supply_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."supply_order_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."supply_order_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."supply_order_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."supply_order_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_subscriptions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "service_role";



GRANT UPDATE("is_paused") ON TABLE "public"."user_subscriptions" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."user_subscriptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_subscriptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_subscriptions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_earnings" TO "anon";
GRANT ALL ON TABLE "public"."vendor_earnings" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_earnings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendor_earnings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendor_earnings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendor_earnings_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vendor_listing_changes" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vendor_listing_changes" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_listing_changes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendor_listing_changes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendor_listing_changes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendor_listing_changes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_order_fulfilment" TO "anon";
GRANT ALL ON TABLE "public"."vendor_order_fulfilment" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_order_fulfilment" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendor_order_fulfilment_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendor_order_fulfilment_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendor_order_fulfilment_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_public" TO "anon";
GRANT ALL ON TABLE "public"."vendor_public" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_public" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_zones" TO "anon";
GRANT ALL ON TABLE "public"."vendor_zones" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_zones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendor_zones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendor_zones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendor_zones_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendors_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendors_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendors_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_transactions" TO "anon";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."wallet_transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wallet_transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wallet_transactions_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































