-- ============================================================
-- 1stOne F1 — Production Database Schema (public schema)
--
-- TRUE schema, regenerated from the LIVE database on 2026-05-18
-- (hardening Task 5). This file replaces the earlier hand-curated
-- bootstrap, which had drifted badly (it documented 29 tables; the
-- live DB has 43, plus dozens of functions / RLS policies it never
-- listed). This file is now the single source of truth for the
-- public schema.
--
-- Body: machine-generated via `supabase db dump --linked --schema public`.
-- The CREATE TRIGGER section at the very end is appended separately —
-- `supabase db dump` emits trigger FUNCTIONS but not the CREATE TRIGGER
-- bindings, so the 24 triggers are pulled directly from the live DB via
-- pg_get_triggerdef() to keep this file complete and rebuildable.
--
-- To regenerate: `supabase db dump --linked --schema public`, then
-- re-append the CREATE TRIGGER statements (pg_get_triggerdef on
-- pg_trigger WHERE NOT tgisinternal).
-- ============================================================




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


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."_kitchen_get_secret"("p_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$           
  DECLARE
    v_secret TEXT;
  BEGIN
    SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = p_name                                                                                                                            
    LIMIT 1;
    RETURN v_secret;                                                                                                                               
  END;            
  $$;


ALTER FUNCTION "public"."_kitchen_get_secret"("p_name" "text") OWNER TO "postgres";


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
  SELECT user_id, status
  INTO v_user_id, v_current_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;

  IF v_current_status = 'Cancelled' THEN
    RAISE EXCEPTION 'order % is already Cancelled', p_order_id;
  END IF;

  -- Once dispatched, cancellation isn't a pure-software action.
  -- Mirror cancel-order's cycle-cutoff guard at the operational level.
  IF v_current_status IN ('Dispatched', 'On the Way', 'Received at Hub', 'Delivered') THEN
    RAISE EXCEPTION 'order % is % — cannot cancel after dispatch', p_order_id, v_current_status;
  END IF;

  -- 1. Cancel the order, APPENDING the reason so prior notes survive.
  UPDATE orders
  SET status     = 'Cancelled',
      notes      = COALESCE(notes || ' | ', '') || '[Admin cancel: ' || p_reason || ']',
      updated_at = NOW()
  WHERE id = p_order_id;

  -- 2. Credit wallet (only if refund > 0). Uses existing
  -- increment_wallet_balance RPC so wallet logic stays centralized.
  -- Both run in this function's transaction; if either raises, the
  -- whole atomic flow rolls back.
  IF p_refund_amount > 0 THEN
    PERFORM public.increment_wallet_balance(
      v_user_id,
      p_refund_amount,
      'Refund — order #' || p_order_id || ' cancelled by admin'
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
      'Prorated refund — subscription #' || p_subscription_id || ' cancelled by admin'
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


CREATE OR REPLACE FUNCTION "public"."assign_addresses_to_hub"("p_hub_id" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_poly jsonb;
  v_count int;
BEGIN
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
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    UPDATE customer_addresses
    SET    hub_id = p_hub_id
    WHERE  id = ANY(p_address_ids);
  $$;


ALTER FUNCTION "public"."assign_hub_to_address_ids"("p_hub_id" integer, "p_address_ids" integer[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_user_id_by_phone"("p_phone" "text") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  SELECT id FROM auth.users WHERE phone = p_phone LIMIT 1;
$$;


ALTER FUNCTION "public"."auth_user_id_by_phone"("p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_onboarding_atomic"("p_user_id" "uuid", "p_phone_number" "text", "p_full_name" "text", "p_label" "text", "p_address_line" "text", "p_landmark" "text" DEFAULT NULL::"text", "p_city" "text" DEFAULT NULL::"text", "p_pincode" "text" DEFAULT NULL::"text", "p_latitude" numeric DEFAULT NULL::numeric, "p_longitude" numeric DEFAULT NULL::numeric, "p_zone_id" integer DEFAULT NULL::integer, "p_hub_id" integer DEFAULT NULL::integer, "p_is_serviceable" boolean DEFAULT false) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
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
      'Wallet topup via Razorpay ' || p_razorpay_payment_id
    );
  END IF;

  RETURN QUERY SELECT v_user_id, v_amount;
END;
$$;


ALTER FUNCTION "public"."complete_wallet_topup"("p_razorpay_order_id" "text", "p_razorpay_payment_id" "text") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."decrement_wallet_balance_if_sufficient"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text" DEFAULT 'Order payment'::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT wallet_balance
  INTO v_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  INSERT INTO wallet_transactions (user_id, transaction_type, amount, description)
  VALUES (p_user_id, 'debit', p_amount, p_description);

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."decrement_wallet_balance_if_sufficient"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."demote_employee"("target_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


CREATE OR REPLACE FUNCTION "public"."elevate_to_staff"("p_user_id" "uuid", "p_full_name" "text", "p_phone_number" "text", "p_designation" "text", "p_joining_date" "date", "p_shift_timing" "text", "p_assigned_hub_id" bigint, "p_monthly_salary" numeric, "p_benefits" "text", "p_joining_bonus" numeric, "p_branch_id" bigint) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_seq         BIGINT;
  v_employee_id TEXT;
  v_existing    TEXT;
  v_target_role TEXT;
BEGIN
  -- FT-03: designation IS the role discriminator. ADMIN HEAD → admin,
  -- anything else → staff. The guard below only refuses the genuine
  -- demote case (existing admin being overwritten to staff via the
  -- wrong path); admin → admin (e.g. completing onboarding fields on
  -- an already-promoted admin profile) is permitted.
  v_target_role := CASE WHEN p_designation = 'ADMIN HEAD' THEN 'admin' ELSE 'staff' END;

  SELECT role INTO v_existing FROM profiles WHERE id = p_user_id;
  IF v_existing = 'admin' AND v_target_role = 'staff' THEN
    RAISE EXCEPTION 'Cannot demote an admin to staff via this path. Change designation away from ADMIN HEAD first.';
  END IF;

  v_seq := nextval('employee_id_seq');
  v_employee_id := '1ST-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT
                          || '-' || LPAD(v_seq::TEXT, 3, '0');

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
    branch_id       = EXCLUDED.branch_id,
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
    );
  END IF;

  RETURN v_employee_id;
END;
$$;


ALTER FUNCTION "public"."elevate_to_staff"("p_user_id" "uuid", "p_full_name" "text", "p_phone_number" "text", "p_designation" "text", "p_joining_date" "date", "p_shift_timing" "text", "p_assigned_hub_id" bigint, "p_monthly_salary" numeric, "p_benefits" "text", "p_joining_bonus" numeric, "p_branch_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_daily_manifest"("p_target_date" "date" DEFAULT ((CURRENT_DATE + '1 day'::interval))::"date", "p_cycle_id" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_orders_created  INTEGER := 0;
  v_orders_skipped  INTEGER := 0;
  v_subs_skipped    INTEGER := 0;
  v_sub             RECORD;
  v_plan            RECORD;
  v_address         RECORD;
  v_new_order_id    BIGINT;
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
    INSERT INTO orders (
      user_id, subscription_id, total_amount, tax_amount, delivery_fee,
      status, order_type, dispatch_date, cycle_id,
      delivery_method, hub_id, payment_method, wallet_amount_used,
      delivery_address_id, branch_id
    )
    VALUES (
      v_sub.user_id, v_sub.sub_id,
      0,  -- BF-19: dispatch rows are not revenue events
      0,  -- BF-19: tax was paid at original purchase
      0,  -- BF-19: delivery fee was paid at original purchase
      'Confirmed',
      -- Normalize plural plan_type ('essentials') to singular order_type
      -- ('essential') so customer + staff order_type filters match.
      CASE WHEN COALESCE(v_plan.plan_type, 'food') = 'food' THEN 'food' ELSE 'essential' END,
      p_target_date, v_plan.cycle_id,
      CASE WHEN v_address.hub_id IS NOT NULL THEN 'hub' ELSE 'direct' END,
      v_address.hub_id, v_sub.payment_method,
      0,  -- BF-01: no wallet debit on dispatch
      v_address.id, v_plan.branch_id
    )
    RETURNING id INTO v_new_order_id;

    -- BF-02: order_items from subscription_plans.plan_items JSON column
    -- (the same column place-order reads from). Earlier read from
    -- subscription_plan_items table which admin UI didn't populate.
    INSERT INTO order_items (order_id, item_id, item_type, item_name, quantity, price_at_time)
    SELECT
      v_new_order_id,
      (item->>'item_id')::INTEGER,
      CASE WHEN COALESCE(v_plan.plan_type, 'food') = 'food' THEN 'food' ELSE 'essential' END,
      COALESCE(item->>'item_name', mi.name, ec.name, 'Item #' || (item->>'item_id')),
      COALESCE((item->>'quantity')::INTEGER, 1),
      COALESCE(mi.price, ec.price, 0)
    FROM subscription_plans sp
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE jsonb_typeof(sp.plan_items::jsonb)
        WHEN 'array' THEN sp.plan_items::jsonb
        ELSE '[]'::jsonb
      END
    ) AS item
    LEFT JOIN menu_items mi
      ON COALESCE(v_plan.plan_type, 'food') = 'food'
      AND mi.id = (item->>'item_id')::INTEGER
    LEFT JOIN essentials_catalog ec
      ON v_plan.plan_type = 'essentials'
      AND ec.id = (item->>'item_id')::INTEGER
    WHERE sp.id = v_sub.plan_id;

    -- Increment consumption + auto-deactivate when complete
    UPDATE user_subscriptions
    SET days_consumed = days_consumed + 1,
        is_active = CASE
          WHEN days_consumed + 1 >= v_plan.duration_days THEN FALSE
          ELSE TRUE
        END
    WHERE id = v_sub.sub_id;

    -- BF-35b: fire customer "Order Confirmed" push via pg_net. Async,
    -- non-blocking — generation proceeds even if send-push is down.
    -- Uses event_key so admin's notification_templates override applies;
    -- fallback title/body provided in case the template row is missing.
    IF v_supa_url IS NOT NULL AND v_svc_key IS NOT NULL THEN
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
        )::text
      );
    END IF;

    v_orders_created := v_orders_created + 1;
  END LOOP;

  -- Audit log
  INSERT INTO manifest_run_log (run_date, orders_created, orders_skipped, subs_skipped)
  VALUES (p_target_date, v_orders_created, v_orders_skipped, v_subs_skipped);

  RETURN jsonb_build_object(
    'target_date',     p_target_date,
    'orders_created',  v_orders_created,
    'orders_skipped',  v_orders_skipped,
    'subs_skipped',    v_subs_skipped
  );

EXCEPTION WHEN OTHERS THEN
  INSERT INTO manifest_run_log (run_date, orders_created, orders_skipped, subs_skipped, error_detail)
  VALUES (p_target_date, v_orders_created, v_orders_skipped, v_subs_skipped, SQLERRM);
  RAISE;
END;
$$;


ALTER FUNCTION "public"."generate_daily_manifest"("p_target_date" "date", "p_cycle_id" integer) OWNER TO "postgres";


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
  -- Only fire on the Pending → (Paid|Confirmed) transition (or direct
  -- INSERT into Paid/Confirmed). Skip everything else.
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
    -- Was this user referred?
    SELECT referred_by INTO v_referrer_id
    FROM public.profiles WHERE id = NEW.user_id;
    IF v_referrer_id IS NULL THEN RETURN NEW; END IF;

    -- Lookup the referrals row + idempotency guard.
    SELECT id, first_order_reward_given INTO v_referral_id, v_already_done
    FROM public.referrals
    WHERE referee_id = NEW.user_id AND referrer_id = v_referrer_id;
    IF v_referral_id IS NULL OR v_already_done THEN RETURN NEW; END IF;

    -- Admin-configurable rewards.
    SELECT
      COALESCE(is_active, FALSE),
      COALESCE(referrer_first_order_credit, 30),
      COALESCE(referrer_first_order_points, 100)
    INTO v_is_active, v_credit, v_points
    FROM public.referral_settings
    LIMIT 1;
    IF NOT v_is_active THEN RETURN NEW; END IF;

    -- "First order" = exactly one non-Cancelled / non-Failed / non-Pending
    -- order exists for this user (the one currently being committed).
    SELECT COUNT(*)::INTEGER INTO v_order_count
    FROM public.orders
    WHERE user_id = NEW.user_id
      AND status NOT IN ('Cancelled', 'Failed', 'Pending');
    IF v_order_count <> 1 THEN RETURN NEW; END IF;

    -- Credit the referrer (wallet + loyalty) via the existing RPCs.
    IF v_credit > 0 THEN
      PERFORM public.increment_wallet_balance(
        v_referrer_id, v_credit,
        'Referral bonus — your friend placed their first order'
      );
    END IF;
    IF v_points > 0 THEN
      PERFORM public.increment_loyalty_points(v_referrer_id, v_points);
    END IF;

    -- Mark the referrals row done so this never double-pays.
    UPDATE public.referrals
    SET status = 'first_order_done',
        first_order_reward_given = TRUE,
        reward_given = TRUE
    WHERE id = v_referral_id;

  EXCEPTION WHEN OTHERS THEN
    -- Defensive: do NOT propagate referral payout errors back to the
    -- caller of the orders UPDATE. Log + continue so a bad referrals row
    -- doesn't block an order from confirming.
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
    AS $$
BEGIN
  UPDATE profiles
  SET loyalty_points = loyalty_points + p_points
  WHERE id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."increment_loyalty_points"("p_user_id" "uuid", "p_points" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text" DEFAULT ''::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id;

  INSERT INTO wallet_transactions (user_id, transaction_type, amount, description)
  VALUES (p_user_id, 'credit', p_amount, p_description);
END;
$$;


ALTER FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text") OWNER TO "postgres";


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
    LANGUAGE "sql" STABLE
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


CREATE OR REPLACE FUNCTION "public"."place_order_atomic"("p_user_id" "uuid", "p_status" "text", "p_order_type" "text", "p_delivery_method" "text", "p_hub_id" bigint, "p_payment_method" "text", "p_razorpay_order_id" "text", "p_delivery_address_id" bigint, "p_notes" "text", "p_branch_id" bigint, "p_groups" "jsonb") RETURNS TABLE("new_order_id" bigint, "new_group_id" "uuid", "new_cycle_id" bigint, "new_dispatch_date" "date")
    LANGUAGE "plpgsql" SECURITY DEFINER
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
      p_order_type,
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


CREATE OR REPLACE FUNCTION "public"."push_kitchen_summary"("p_cycle_id" integer, "p_target_date" "date" DEFAULT CURRENT_DATE) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
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
  BEGIN           
    SELECT id, cycle_name, branch_id
    INTO v_cycle                                                                                                                                   
    FROM delivery_cycles
    WHERE id = p_cycle_id AND is_active = TRUE;                                                                                                    
                                                                                                                                                   
    IF v_cycle IS NULL THEN
      RETURN jsonb_build_object('status', 'skipped', 'reason', 'cycle not found or inactive');                                                     
    END IF;                                                                                                                                        
   
    v_branch_id := v_cycle.branch_id;                                                                                                              
                  
    SELECT COUNT(*)::INTEGER                                                                                                                       
    INTO v_orders_count
    FROM orders o                                                                                                                                  
    WHERE o.cycle_id       = p_cycle_id
      AND o.dispatch_date  = p_target_date
      AND o.status         IN ('Confirmed', 'Paid', 'Preparing');                                                                                  
   
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
        AND o.status        IN ('Confirmed', 'Paid', 'Preparing')                                                                                  
      GROUP BY oi.item_name                                                                                                                        
    ) agg;
                                                                                                                                                   
    INSERT INTO kitchen_push_log (cycle_id, push_date, orders_count, items_summary)                                                                
    VALUES (p_cycle_id, p_target_date, v_orders_count, COALESCE(v_summary, ''))
    ON CONFLICT (cycle_id, push_date) DO NOTHING;                                                                                                  
                                                                                                                                                   
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'duplicate', 'cycle_id', p_cycle_id, 'target_date', p_target_date);                                      
    END IF;                                                                                                                                        
   
    IF v_orders_count = 0 THEN                                                                                                                     
      RETURN jsonb_build_object('status', 'no_orders', 'cycle_id', p_cycle_id, 'target_date', p_target_date);
    END IF;                                                                                                                                        
   
    v_payload := jsonb_build_object(                                                                                                               
      'role',       'staff',
      'branch_id',  v_branch_id,                                                                                                                   
      'title',      'Kitchen order summary — ' || v_cycle.cycle_name,
      'body',       v_orders_count || ' orders ready to start. ' || COALESCE(v_summary, ''),                                                       
      'data',       jsonb_build_object('screen', 'StaffDashboard', 'cycle_id', p_cycle_id)                                                         
    );                                                                                                                                             
                                                                                                                                                   
    v_url := _kitchen_get_secret('supabase_url');                                                                                                  
    v_key := _kitchen_get_secret('service_role_key');
                                                                                                                                                   
    IF v_url IS NULL OR v_key IS NULL THEN                                                                                                         
      RAISE WARNING '[push_kitchen_summary] Missing vault secret supabase_url or service_role_key';
      RETURN jsonb_build_object('status', 'no_vault_secret', 'cycle_id', p_cycle_id);                                                              
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
    SET http_request_id = v_req_id
    WHERE cycle_id = p_cycle_id AND push_date = p_target_date;                                                                                     
   
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


CREATE OR REPLACE FUNCTION "public"."set_employee_designation"("target_id" "uuid", "new_designation" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


CREATE OR REPLACE FUNCTION "public"."trigger_kitchen_cutoff_pushes"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$           
  DECLARE
    v_cycle       RECORD;
    v_ist_now     TIMESTAMPTZ;
    v_ist_date    DATE;                                                                                                                            
    v_ist_time    TIME;
    v_target_date DATE;                                                                                                                            
  BEGIN           
    v_ist_now  := NOW() AT TIME ZONE 'Asia/Kolkata';
    v_ist_date := v_ist_now::DATE;                                                                                                                 
    v_ist_time := v_ist_now::TIME;
                                                                                                                                                   
    FOR v_cycle IN
      SELECT dc.id, dc.kitchen_push_time, dc.cutoff_time, dc.delivery_start                                                                        
      FROM delivery_cycles dc                                                                                                                      
      WHERE dc.is_active = TRUE
        AND v_ist_time >= dc.kitchen_push_time                                                                                                     
    LOOP                                                                                                                                           
      -- Cross-midnight: cutoff at night, delivery next morning
      IF v_cycle.cutoff_time > v_cycle.delivery_start THEN                                                                                         
        v_target_date := v_ist_date + 1;
      ELSE                                                                                                                                         
        v_target_date := v_ist_date;
      END IF;                                                                                                                                      
                  
      -- Dedup keyed to delivery date (not push date)                                                                                              
      CONTINUE WHEN EXISTS (
        SELECT 1                                                                                                                                   
        FROM kitchen_push_log kpl
        WHERE kpl.cycle_id  = v_cycle.id                                                                                                           
          AND kpl.push_date = v_target_date                                                                                                        
      );
                                                                                                                                                   
      -- Generate subscription orders for this cycle's delivery date first                                                                         
      PERFORM generate_daily_manifest(
        p_target_date => v_target_date,                                                                                                            
        p_cycle_id    => v_cycle.id
      );                                                                                                                                           
   
      -- Push kitchen summary                                                                                                                      
      PERFORM push_kitchen_summary(v_cycle.id, v_target_date);
    END LOOP;
  END;
  $$;


ALTER FUNCTION "public"."trigger_kitchen_cutoff_pushes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_employee_profile"("target_id" "uuid", "updates" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
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

SET default_tablespace = '';

SET default_table_access_method = "heap";


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
    "updated_at" timestamp with time zone DEFAULT "now"()
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
    "essentials_label" "text"
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
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."essentials_catalog" OWNER TO "postgres";


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
    CONSTRAINT "expense_claims_category_check" CHECK (("category" = ANY (ARRAY['Grocery'::"text", 'Vegetable'::"text", 'Stationery'::"text", 'Fuel'::"text", 'Expense'::"text"]))),
    CONSTRAINT "expense_claims_status_check" CHECK (("status" = ANY (ARRAY['Pending'::"text", 'Approved'::"text", 'Rejected'::"text", 'Paid'::"text"])))
);


ALTER TABLE "public"."expense_claims" OWNER TO "postgres";


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
    "http_request_id" bigint
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
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."menu_items" OWNER TO "postgres";


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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
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
    CONSTRAINT "orders_delivery_method_check" CHECK (("delivery_method" = ANY (ARRAY['direct'::"text", 'hub'::"text"]))),
    CONSTRAINT "orders_order_type_check" CHECK (("order_type" = ANY (ARRAY['food'::"text", 'essential'::"text"]))),
    CONSTRAINT "orders_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['wallet'::"text", 'razorpay'::"text", 'split'::"text"]))),
    CONSTRAINT "orders_status_allowed" CHECK (("status" = ANY (ARRAY['Pending'::"text", 'Confirmed'::"text", 'Paid'::"text", 'Preparing'::"text", 'Ready'::"text", 'Packed'::"text", 'Dispatched'::"text", 'Received at Hub'::"text", 'On the Way'::"text", 'Delivered'::"text", 'Cancelled'::"text", 'Failed'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


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
    CONSTRAINT "referrals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."referrals" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."referrals_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."referrals_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."referrals_id_seq" OWNED BY "public"."referrals"."id";



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
    "low_wallet_threshold" numeric DEFAULT 200,
    "winback_inactive_days" integer DEFAULT 14,
    "max_wallet_topup" numeric DEFAULT 50000 NOT NULL
);


ALTER TABLE "public"."store_config" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."store_config_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."store_config_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."store_config_id_seq" OWNED BY "public"."store_config"."id";



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
    CONSTRAINT "subscription_plans_plan_type_check" CHECK (("plan_type" = ANY (ARRAY['food'::"text", 'essentials'::"text"])))
);


ALTER TABLE "public"."subscription_plans" OWNER TO "postgres";


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



ALTER TABLE ONLY "public"."staff_attendance" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_attendance_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_leaves" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_leaves_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_order_requests" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_order_requests_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_salary" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_salary_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_shifts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_shifts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."store_config" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."store_config_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subscription_plan_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subscription_plan_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subscription_plans" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subscription_plans_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."supply_batches" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."supply_batches_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."supply_order_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."supply_order_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."user_subscriptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_subscriptions_id_seq"'::"regclass");



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



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "customer_addresses_one_default_per_user" ON "public"."customer_addresses" USING "btree" ("user_id") WHERE ("is_default" = true);



CREATE INDEX "idx_addresses_hub" ON "public"."customer_addresses" USING "btree" ("hub_id");



CREATE INDEX "idx_addresses_user" ON "public"."customer_addresses" USING "btree" ("user_id");



CREATE INDEX "idx_addresses_zone" ON "public"."customer_addresses" USING "btree" ("zone_id");



CREATE INDEX "idx_attendance_date" ON "public"."staff_attendance" USING "btree" ("date");



CREATE INDEX "idx_attendance_staff" ON "public"."staff_attendance" USING "btree" ("staff_id");



CREATE INDEX "idx_cancelled_days_date" ON "public"."cancelled_subscription_days" USING "btree" ("cancelled_date");



CREATE INDEX "idx_cancelled_days_sub" ON "public"."cancelled_subscription_days" USING "btree" ("subscription_id");



CREATE INDEX "idx_cancelled_subscription_days_branch" ON "public"."cancelled_subscription_days" USING "btree" ("branch_id");



CREATE INDEX "idx_customer_addresses_branch" ON "public"."customer_addresses" USING "btree" ("branch_id");



CREATE INDEX "idx_delivery_cycles_active" ON "public"."delivery_cycles" USING "btree" ("is_active");



CREATE INDEX "idx_delivery_cycles_branch" ON "public"."delivery_cycles" USING "btree" ("branch_id");



CREATE INDEX "idx_delivery_hubs_active" ON "public"."delivery_hubs" USING "btree" ("is_active");



CREATE INDEX "idx_essentials_active" ON "public"."essentials_catalog" USING "btree" ("is_active");



CREATE INDEX "idx_essentials_cycle" ON "public"."essentials_catalog" USING "btree" ("cycle_id");



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



CREATE INDEX "idx_order_items_order" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "idx_orders_branch" ON "public"."orders" USING "btree" ("branch_id");



CREATE INDEX "idx_orders_created" ON "public"."orders" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_orders_cycle" ON "public"."orders" USING "btree" ("cycle_id");



CREATE INDEX "idx_orders_dispatch" ON "public"."orders" USING "btree" ("dispatch_date");



CREATE INDEX "idx_orders_group" ON "public"."orders" USING "btree" ("order_group_id");



CREATE INDEX "idx_orders_hub" ON "public"."orders" USING "btree" ("hub_id");



CREATE INDEX "idx_orders_status" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "idx_orders_sub" ON "public"."orders" USING "btree" ("subscription_id");



CREATE INDEX "idx_orders_type" ON "public"."orders" USING "btree" ("order_type");



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



CREATE INDEX "idx_wallet_tx_created" ON "public"."wallet_transactions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_wallet_tx_user" ON "public"."wallet_transactions" USING "btree" ("user_id");



CREATE INDEX "order_item_ratings_order_idx" ON "public"."order_item_ratings" USING "btree" ("order_id");



CREATE INDEX "push_logs_sent_at_idx" ON "public"."push_logs" USING "btree" ("sent_at" DESC);



CREATE INDEX "push_logs_status_idx" ON "public"."push_logs" USING "btree" ("status");



CREATE INDEX "push_logs_trigger_idx" ON "public"."push_logs" USING "btree" ("trigger_source", "sent_at" DESC);



CREATE INDEX "push_logs_user_id_idx" ON "public"."push_logs" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "staff_order_requests_mirror" AFTER INSERT ON "public"."staff_order_requests" FOR EACH ROW EXECUTE FUNCTION "public"."mirror_staff_request_to_supply_items"();



CREATE OR REPLACE TRIGGER "trg_address_branch_id" BEFORE INSERT OR UPDATE OF "hub_id", "zone_id" ON "public"."customer_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."derive_address_branch_id"();



CREATE OR REPLACE TRIGGER "trg_addresses_updated" BEFORE UPDATE ON "public"."customer_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_admin_notes_updated" BEFORE UPDATE ON "public"."admin_notes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_banners_updated" BEFORE UPDATE ON "public"."banners" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_branches_updated" BEFORE UPDATE ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_delivery_cycles_updated" BEFORE UPDATE ON "public"."delivery_cycles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_delivery_hubs_updated" BEFORE UPDATE ON "public"."delivery_hubs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_delivery_zones_updated" BEFORE UPDATE ON "public"."delivery_zones" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_essentials_updated" BEFORE UPDATE ON "public"."essentials_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_expense_updated" BEFORE UPDATE ON "public"."expense_claims" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_feature_flags_updated" BEFORE UPDATE ON "public"."feature_flags" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_first_order_referral_bonus" AFTER INSERT OR UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."handle_first_order_referral_bonus"();



CREATE OR REPLACE TRIGGER "trg_leaves_updated" BEFORE UPDATE ON "public"."staff_leaves" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_menu_items_updated" BEFORE UPDATE ON "public"."menu_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_orders_updated" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_push_tokens_updated" BEFORE UPDATE ON "public"."push_notification_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_referral_settings_updated" BEFORE UPDATE ON "public"."referral_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_salary_updated" BEFORE UPDATE ON "public"."staff_salary" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_shifts_updated" BEFORE UPDATE ON "public"."staff_shifts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_store_config_updated" BEFORE UPDATE ON "public"."store_config" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_sub_plans_updated" BEFORE UPDATE ON "public"."subscription_plans" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_user_subs_updated" BEFORE UPDATE ON "public"."user_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."admin_notes"
    ADD CONSTRAINT "admin_notes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."admin_notes"
    ADD CONSTRAINT "admin_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."app_feedback"
    ADD CONSTRAINT "app_feedback_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."app_feedback"
    ADD CONSTRAINT "app_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



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



ALTER TABLE ONLY "public"."expense_claims"
    ADD CONSTRAINT "expense_claims_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."expense_claims"
    ADD CONSTRAINT "expense_claims_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



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



ALTER TABLE ONLY "public"."push_logs"
    ADD CONSTRAINT "push_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."push_notification_tokens"
    ADD CONSTRAINT "push_notification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referee_id_fkey" FOREIGN KEY ("referee_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "public"."profiles"("id");



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



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



CREATE POLICY "addresses_self" ON "public"."customer_addresses" USING ((("user_id" = "auth"."uid"()) OR ("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id"))));



CREATE POLICY "admin read templates" ON "public"."notification_templates" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'user_role'::"text") = 'admin'::"text"));



CREATE POLICY "admin write templates" ON "public"."notification_templates" FOR UPDATE TO "authenticated" USING ((("auth"."jwt"() ->> 'user_role'::"text") = 'admin'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'user_role'::"text") = 'admin'::"text"));



ALTER TABLE "public"."admin_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_notes_admin" ON "public"."admin_notes" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "admin_notes_read" ON "public"."admin_notes" FOR SELECT USING (("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id")));



ALTER TABLE "public"."app_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_settings_admin_update" ON "public"."app_settings" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "app_settings_public_read" ON "public"."app_settings" FOR SELECT USING (true);



CREATE POLICY "attendance_self" ON "public"."staff_attendance" USING ((("staff_id" = "auth"."uid"()) OR ("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))));



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



ALTER TABLE "public"."expense_claims" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expense_claims_self" ON "public"."expense_claims" USING ((("staff_id" = "auth"."uid"()) OR ("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))));



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



CREATE POLICY "salary_admin" ON "public"."staff_salary" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "salary_admin_all" ON "public"."staff_salary" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "salary_self" ON "public"."staff_salary" FOR SELECT USING ((("staff_id" = "auth"."uid"()) OR ("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))));



ALTER TABLE "public"."staff_attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_leaves" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_order_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_order_requests_admin" ON "public"."staff_order_requests" USING ("public"."is_admin"());



CREATE POLICY "staff_order_requests_self_insert" ON "public"."staff_order_requests" FOR INSERT WITH CHECK ((("submitted_by" = "auth"."uid"()) AND "public"."is_staff_or_admin"()));



CREATE POLICY "staff_order_requests_self_read" ON "public"."staff_order_requests" FOR SELECT USING ((("submitted_by" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "staff_order_requests_staff" ON "public"."staff_order_requests" FOR SELECT USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."staff_salary" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_shifts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_shifts_admin" ON "public"."staff_shifts" USING ("public"."is_admin"());



CREATE POLICY "staff_shifts_read" ON "public"."staff_shifts" FOR SELECT USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."store_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "store_config_admin" ON "public"."store_config" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "store_config_read" ON "public"."store_config" FOR SELECT USING (true);



ALTER TABLE "public"."subscription_plan_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscription_plan_items_admin_write" ON "public"."subscription_plan_items" USING (("public"."is_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."subscription_plans" "sp"
  WHERE (("sp"."id" = "subscription_plan_items"."plan_id") AND "public"."has_branch_access"("sp"."branch_id")))))) WITH CHECK (("public"."is_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."subscription_plans" "sp"
  WHERE (("sp"."id" = "subscription_plan_items"."plan_id") AND "public"."has_branch_access"("sp"."branch_id"))))));



CREATE POLICY "subscription_plan_items_read_all" ON "public"."subscription_plan_items" FOR SELECT USING (true);



ALTER TABLE "public"."subscription_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscription_plans_admin_write" ON "public"."subscription_plans" USING (("public"."is_admin"() AND "public"."has_branch_access"("branch_id"))) WITH CHECK (("public"."is_admin"() AND "public"."has_branch_access"("branch_id")));



CREATE POLICY "subscription_plans_read_all" ON "public"."subscription_plans" FOR SELECT USING (true);



ALTER TABLE "public"."supply_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supply_batches_admin" ON "public"."supply_batches" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "supply_batches_staff" ON "public"."supply_batches" USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."supply_catalog" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supply_catalog_admin" ON "public"."supply_catalog" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "supply_catalog_staff_read" ON "public"."supply_catalog" FOR SELECT USING ("public"."is_staff_or_admin"());



ALTER TABLE "public"."supply_order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supply_order_items_admin" ON "public"."supply_order_items" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "supply_order_items_staff" ON "public"."supply_order_items" USING ("public"."is_staff_or_admin"());



CREATE POLICY "user_subs_self" ON "public"."user_subscriptions" USING ((("user_id" = "auth"."uid"()) OR ("public"."is_staff_or_admin"() AND "public"."has_branch_access"("branch_id"))));



ALTER TABLE "public"."user_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wallet_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallet_tx_no_writes" ON "public"."wallet_transactions" FOR INSERT WITH CHECK (("public"."is_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "wallet_transactions"."user_id") AND "public"."has_branch_access"("p"."branch_id"))))));



CREATE POLICY "wallet_tx_self" ON "public"."wallet_transactions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("public"."is_staff_or_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "wallet_transactions"."user_id") AND "public"."has_branch_access"("p"."branch_id")))))));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."_kitchen_get_secret"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_kitchen_get_secret"("p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_or_merge_supply_order_item"("p_name" "text", "p_qty" integer, "p_category" "text", "p_request_id" bigint, "p_added_by" "uuid", "p_branch_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_or_merge_supply_order_item"("p_name" "text", "p_qty" integer, "p_category" "text", "p_request_id" bigint, "p_added_by" "uuid", "p_branch_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."add_or_merge_supply_order_item"("p_name" "text", "p_qty" integer, "p_category" "text", "p_request_id" bigint, "p_added_by" "uuid", "p_branch_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_or_merge_supply_order_item"("p_name" "text", "p_qty" integer, "p_category" "text", "p_request_id" bigint, "p_added_by" "uuid", "p_branch_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_cancel_order_atomic"("p_order_id" bigint, "p_refund_amount" numeric, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_cancel_order_atomic"("p_order_id" bigint, "p_refund_amount" numeric, "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_cancel_order_atomic"("p_order_id" bigint, "p_refund_amount" numeric, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_cancel_order_atomic"("p_order_id" bigint, "p_refund_amount" numeric, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_cancel_subscription_atomic"("p_subscription_id" bigint, "p_refund_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_cancel_subscription_atomic"("p_subscription_id" bigint, "p_refund_amount" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_cancel_subscription_atomic"("p_subscription_id" bigint, "p_refund_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_cancel_subscription_atomic"("p_subscription_id" bigint, "p_refund_amount" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_addresses_to_hub"("p_hub_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."assign_addresses_to_hub"("p_hub_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_addresses_to_hub"("p_hub_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_hub_operator"("p_hub_id" bigint, "p_new_user_id" "uuid", "p_old_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_hub_operator"("p_hub_id" bigint, "p_new_user_id" "uuid", "p_old_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_hub_operator"("p_hub_id" bigint, "p_new_user_id" "uuid", "p_old_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_hub_to_address_ids"("p_hub_id" integer, "p_address_ids" integer[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_hub_to_address_ids"("p_hub_id" integer, "p_address_ids" integer[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_hub_to_address_ids"("p_hub_id" integer, "p_address_ids" integer[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."auth_user_id_by_phone"("p_phone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auth_user_id_by_phone"("p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."auth_user_id_by_phone"("p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_user_id_by_phone"("p_phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_onboarding_atomic"("p_user_id" "uuid", "p_phone_number" "text", "p_full_name" "text", "p_label" "text", "p_address_line" "text", "p_landmark" "text", "p_city" "text", "p_pincode" "text", "p_latitude" numeric, "p_longitude" numeric, "p_zone_id" integer, "p_hub_id" integer, "p_is_serviceable" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."complete_onboarding_atomic"("p_user_id" "uuid", "p_phone_number" "text", "p_full_name" "text", "p_label" "text", "p_address_line" "text", "p_landmark" "text", "p_city" "text", "p_pincode" "text", "p_latitude" numeric, "p_longitude" numeric, "p_zone_id" integer, "p_hub_id" integer, "p_is_serviceable" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_onboarding_atomic"("p_user_id" "uuid", "p_phone_number" "text", "p_full_name" "text", "p_label" "text", "p_address_line" "text", "p_landmark" "text", "p_city" "text", "p_pincode" "text", "p_latitude" numeric, "p_longitude" numeric, "p_zone_id" integer, "p_hub_id" integer, "p_is_serviceable" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_wallet_topup"("p_razorpay_order_id" "text", "p_razorpay_payment_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_wallet_topup"("p_razorpay_order_id" "text", "p_razorpay_payment_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."decrement_wallet_balance_if_sufficient"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decrement_wallet_balance_if_sufficient"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."demote_employee"("target_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."demote_employee"("target_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."demote_employee"("target_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."derive_address_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."derive_address_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."derive_address_branch_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."elevate_to_staff"("p_user_id" "uuid", "p_full_name" "text", "p_phone_number" "text", "p_designation" "text", "p_joining_date" "date", "p_shift_timing" "text", "p_assigned_hub_id" bigint, "p_monthly_salary" numeric, "p_benefits" "text", "p_joining_bonus" numeric, "p_branch_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."elevate_to_staff"("p_user_id" "uuid", "p_full_name" "text", "p_phone_number" "text", "p_designation" "text", "p_joining_date" "date", "p_shift_timing" "text", "p_assigned_hub_id" bigint, "p_monthly_salary" numeric, "p_benefits" "text", "p_joining_bonus" numeric, "p_branch_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_daily_manifest"("p_target_date" "date", "p_cycle_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_daily_manifest"("p_target_date" "date", "p_cycle_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_addresses_for_hub_assignment"("p_hub_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_addresses_for_hub_assignment"("p_hub_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_addresses_for_hub_assignment"("p_hub_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_hub_impact_addresses"("p_hub_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_hub_impact_addresses"("p_hub_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_hub_impact_addresses"("p_hub_id" integer) TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."increment_wallet_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_staff_or_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_staff_or_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_staff_or_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
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



GRANT ALL ON FUNCTION "public"."mirror_staff_request_to_supply_items"() TO "anon";
GRANT ALL ON FUNCTION "public"."mirror_staff_request_to_supply_items"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mirror_staff_request_to_supply_items"() TO "service_role";



GRANT ALL ON FUNCTION "public"."place_order_atomic"("p_user_id" "uuid", "p_status" "text", "p_order_type" "text", "p_delivery_method" "text", "p_hub_id" bigint, "p_payment_method" "text", "p_razorpay_order_id" "text", "p_delivery_address_id" bigint, "p_notes" "text", "p_branch_id" bigint, "p_groups" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."place_order_atomic"("p_user_id" "uuid", "p_status" "text", "p_order_type" "text", "p_delivery_method" "text", "p_hub_id" bigint, "p_payment_method" "text", "p_razorpay_order_id" "text", "p_delivery_address_id" bigint, "p_notes" "text", "p_branch_id" bigint, "p_groups" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."place_order_atomic"("p_user_id" "uuid", "p_status" "text", "p_order_type" "text", "p_delivery_method" "text", "p_hub_id" bigint, "p_payment_method" "text", "p_razorpay_order_id" "text", "p_delivery_address_id" bigint, "p_notes" "text", "p_branch_id" bigint, "p_groups" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."point_in_polygon"("p_lat" double precision, "p_lng" double precision, "p_poly" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."point_in_polygon"("p_lat" double precision, "p_lng" double precision, "p_poly" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."point_in_polygon"("p_lat" double precision, "p_lng" double precision, "p_poly" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."push_kitchen_summary"("p_cycle_id" integer, "p_target_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."push_kitchen_summary"("p_cycle_id" integer, "p_target_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_address_serviceability"("p_lat" double precision, "p_lng" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_address_serviceability"("p_lat" double precision, "p_lng" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_address_serviceability"("p_lat" double precision, "p_lng" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_employee_designation"("target_id" "uuid", "new_designation" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_employee_designation"("target_id" "uuid", "new_designation" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_employee_designation"("target_id" "uuid", "new_designation" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."trigger_kitchen_cutoff_pushes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trigger_kitchen_cutoff_pushes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_employee_profile"("target_id" "uuid", "updates" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_employee_profile"("target_id" "uuid", "updates" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_employee_profile"("target_id" "uuid", "updates" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



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



GRANT ALL ON TABLE "public"."essentials_catalog" TO "anon";
GRANT ALL ON TABLE "public"."essentials_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."essentials_catalog" TO "service_role";



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
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."order_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



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



GRANT ALL ON TABLE "public"."staff_attendance" TO "anon";
GRANT ALL ON TABLE "public"."staff_attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_attendance" TO "service_role";



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



GRANT ALL ON TABLE "public"."subscription_plan_items" TO "anon";
GRANT ALL ON TABLE "public"."subscription_plan_items" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_plan_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subscription_plan_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subscription_plan_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subscription_plan_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_plans" TO "anon";
GRANT ALL ON TABLE "public"."subscription_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_plans" TO "service_role";



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
GRANT ALL ON TABLE "public"."user_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_subscriptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_subscriptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_subscriptions_id_seq" TO "service_role";



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









-- ============================================================
-- TRIGGERS
-- Appended separately — see the header note. Pulled from the live DB
-- via pg_get_triggerdef() (24 triggers, NOT tgisinternal).
-- ============================================================

CREATE TRIGGER trg_admin_notes_updated BEFORE UPDATE ON public.admin_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_banners_updated BEFORE UPDATE ON public.banners FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_branches_updated BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_address_branch_id BEFORE INSERT OR UPDATE OF hub_id, zone_id ON public.customer_addresses FOR EACH ROW EXECUTE FUNCTION derive_address_branch_id();
CREATE TRIGGER trg_addresses_updated BEFORE UPDATE ON public.customer_addresses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_delivery_cycles_updated BEFORE UPDATE ON public.delivery_cycles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_delivery_hubs_updated BEFORE UPDATE ON public.delivery_hubs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_delivery_zones_updated BEFORE UPDATE ON public.delivery_zones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_essentials_updated BEFORE UPDATE ON public.essentials_catalog FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_expense_updated BEFORE UPDATE ON public.expense_claims FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_feature_flags_updated BEFORE UPDATE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_menu_items_updated BEFORE UPDATE ON public.menu_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_first_order_referral_bonus AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION handle_first_order_referral_bonus();
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_push_tokens_updated BEFORE UPDATE ON public.push_notification_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_referral_settings_updated BEFORE UPDATE ON public.referral_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_leaves_updated BEFORE UPDATE ON public.staff_leaves FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER staff_order_requests_mirror AFTER INSERT ON public.staff_order_requests FOR EACH ROW EXECUTE FUNCTION mirror_staff_request_to_supply_items();
CREATE TRIGGER trg_salary_updated BEFORE UPDATE ON public.staff_salary FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_shifts_updated BEFORE UPDATE ON public.staff_shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_store_config_updated BEFORE UPDATE ON public.store_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_sub_plans_updated BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_user_subs_updated BEFORE UPDATE ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
