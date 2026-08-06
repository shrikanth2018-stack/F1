-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Twelve SECURITY DEFINER functions anyone could call
-- (2026-08-06)
--
-- Postgres grants EXECUTE to PUBLIC on every function it creates unless told
-- otherwise. Most of this schema remembers to REVOKE; twelve functions did
-- not, and `anon` — whose key ships inside the APK — inherited PUBLIC.
--
-- PROVEN, not inferred. Against production, with the shipped anon key and no
-- login at all:
--
--   POST /rest/v1/rpc/auth_user_id_by_phone {"p_phone":"915555555555"}
--     → 200  "dc1f98ea-617c-4e63-814f-ed4fe3365647"
--   POST /rest/v1/rpc/mark_order_paid  (correctly locked, for contrast)
--     → 401  permission denied for function mark_order_paid
--
-- `increment_wallet_balance` carries the identical grant and its body is an
-- unguarded `UPDATE profiles SET wallet_balance = wallet_balance + p_amount`.
-- Two calls — phone to user id, user id to unlimited credit — and the wallet
-- ledger invariant this whole system rests on is gone. The decrement variant
-- drains instead. Neither was fired; the contrast above makes it unnecessary.
--
-- `auth_user_id_by_phone` is the sharpest of these because its OWN migration
-- already revoked it (add_auth_user_id_by_phone_rpc.sql:19-33) with a comment
-- saying it would leak auth user IDs by phone enumeration otherwise. A later
-- broad re-grant clobbered that. A lockdown is not a thing you do once.
--
-- WHY NOT SIMPLY REVOKE EVERYTHING FROM `authenticated` TOO
-- Because four of these have real client callers, and a fix that breaks a
-- working flow is worse than the hole it closes. Every caller was enumerated
-- before a single grant was touched:
--
--   increment_wallet_balance        useReferrals.ts:213 — an ADMIN issuing a
--                                   referral month bonus. Live.
--   assign_addresses_to_hub         useDeliveryHubs.ts — an admin redrawing a
--                                   hub polygon. Live.
--   add_or_merge_supply_order_item  useStockManager.ts — admin stock entry.
--   get_active_staff_batch          useActiveStaffBatch.ts — every staff,
--                                   driver and hub screen.
--   resolve_address_serviceability  AddAddressScreen / OnboardingScreen /
--                                   AdminCreateCustomer. Onboarding runs
--                                   AFTER OTP verify, so the caller is always
--                                   authenticated — checked, not assumed.
--
--   (AdminSubscriptionsScreen also mentions increment_wallet_balance, but
--    only in a COMMENT recording that its direct call was retired in BF-20.)
--
-- So: anon loses everything. `authenticated` keeps only what a screen truly
-- calls, and the two that move money or move other people's rows gain an
-- is_admin() check of their own, because a grant says WHO may call and these
-- needed to say WHAT they may do.
--
-- THE GUARD SHAPE, and why `auth.uid() IS NULL` is safe here.
-- Edge functions call these with the service-role key, which carries no `sub`
-- — so auth.uid() is NULL for them, and a NULL uid has to pass or every
-- server-side money movement breaks. anon ALSO has a NULL uid, which would
-- make that test useless on its own. It is not on its own: anon's EXECUTE is
-- revoked below, so the only NULL-uid caller that can still reach the body is
-- the service role. Grant and guard are load-bearing together; removing
-- either one reopens this.
--
-- TRIGGER FUNCTIONS ARE DELIBERATELY LEFT ALONE. Eight of them are also
-- granted to anon (trg_credit_vendor_earnings, the branch_id setters, …).
-- They return `trigger`, so PostgREST will not expose them and they cannot be
-- invoked meaningfully by an HTTP caller. Revoking risks breaking a trigger
-- for no security gain — the wrong trade on a live system.
--
-- Deploy: supabase db query --linked --file supabase/sql/lock_down_definer_functions.sql
-- Idempotent. Safe to re-run. Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════


-- ── 1. Server-only: no client has ever called these ────────────
-- Money movement, the phone→uid lookup, and the four cron entry points.
-- service_role keeps its explicit grant so the edge functions and pg_cron
-- (which runs as the table owner) are untouched.

REVOKE ALL ON FUNCTION public.decrement_wallet_balance_if_sufficient(uuid, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_wallet_balance_if_sufficient(uuid, numeric, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.tag_wallet_debit_to_order(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tag_wallet_debit_to_order(uuid, bigint) TO service_role;

REVOKE ALL ON FUNCTION public.auth_user_id_by_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_phone(text) TO service_role;

REVOKE ALL ON FUNCTION public.prune_operational_logs()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.alert_cron_failures()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.alert_missing_kitchen_pushes()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.external_heartbeat()            FROM PUBLIC, anon, authenticated;


-- ── 2. Signed-in only: a real screen calls these ───────────────
-- anon loses EXECUTE; `authenticated` keeps it because a customer adding an
-- address, or a staff phone resolving its batch, genuinely needs it.

REVOKE ALL ON FUNCTION public.get_active_staff_batch(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_staff_batch(integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_address_serviceability(double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_address_serviceability(double precision, double precision) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.add_or_merge_supply_order_item(text, integer, text, bigint, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_or_merge_supply_order_item(text, integer, text, bigint, uuid, integer) TO authenticated, service_role;


-- ── 3. increment_wallet_balance: grants only, NO body guard ────
--
-- A GUARD IN THE BODY WAS TRIED AND REVERTED. Writing
-- `IF auth.uid() IS NOT NULL AND NOT is_admin() THEN RAISE` inside this
-- function looks right and is wrong, because FIVE SECURITY DEFINER callers
-- reach it while carrying an ordinary user's auth.uid():
--
--   credit_vendor_earnings_for_order    fires when STAFF mark an order
--                                       Delivered → uid is the staffer
--   handle_first_order_referral_bonus   trigger on a customer's first order
--   complete_wallet_topup               after a Razorpay top-up
--   admin_cancel_order_atomic           refund on cancel
--   admin_cancel_subscription_atomic    prorated refund
--
-- The guard blocked the vendor credit outright — and because that trigger
-- isolates its own exceptions, the delivery would still have committed while
-- the vendor was silently never paid. platform_health_check §E caught it
-- (E1/E2/E3 went red) before it reached anyone.
--
-- GRANTS ARE THE RIGHT MECHANISM and the body guard is not, for one reason:
-- a SECURITY DEFINER function executes as its OWNER, so all five callers
-- satisfy a grant check, while auth.uid() keeps returning the end user and
-- fails a body check. Same intent, opposite outcome.
--
-- SERVER-SIDE ONLY. §4 below moved the one client caller
-- (useReferrals.ts useIssueMonthBonus) onto a purpose-built admin RPC and
-- deleted its `creditWallet` helper, so nothing a phone can reach needs this
-- any more. The five SECURITY DEFINER callers listed above are unaffected —
-- each executes as the function owner, which satisfies the grant.

REVOKE ALL   ON FUNCTION public.increment_wallet_balance(uuid, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_wallet_balance(uuid, numeric, text, text, text) TO service_role;

-- Bulk-reassigns hub_id across customer_addresses. An admin action when a hub
-- polygon is redrawn; it rewrites OTHER people's delivery routing, so it is
-- the one function here where "any logged-in user" was never acceptable.
-- Body below is the LIVE definition, copied verbatim from
-- pg_get_functiondef. The only edit is the guard at the top. Reconstructing
-- it from the repo would have been wrong — the deployed version matches on
-- `polygon_geojson` with its own validity check, which is not what an
-- educated guess produces.
CREATE OR REPLACE FUNCTION public.assign_addresses_to_hub(p_hub_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.assign_addresses_to_hub(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_addresses_to_hub(integer) TO authenticated, service_role;


-- ── 4. The one client call that still needs the raw money RPC ──
--
-- `useIssueMonthBonus` credits a referrer's wallet and then marks the
-- referral row — two round-trips from a phone, so a failure between them
-- either pays twice on retry or pays once and never records it. Folding both
-- into one admin-gated RPC removes the direct wallet call AND the gap.
--
-- Safe as a body guard where increment_wallet_balance was not: nothing calls
-- this internally, so auth.uid() is always the admin who pressed the button.
CREATE OR REPLACE FUNCTION public.admin_issue_referral_month_bonus(p_referral_id integer)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL   ON FUNCTION public.admin_issue_referral_month_bonus(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_issue_referral_month_bonus(integer) TO authenticated, service_role;


-- ── 5. Defence in depth: anon executes NO definer function ─────
--
-- Sixteen more were still anon-reachable. Every one of them does check the
-- caller in its own body, so none was exploitable — but "not exploitable
-- because the body happens to check" is one careless edit away from being
-- exploitable, and `auth_user_id_by_phone` is the proof: its own migration
-- revoked it and something later granted it back.
--
-- Expressed as a sweep rather than sixteen named REVOKEs, because the rule is
-- the point: anon should not execute ANY SECURITY DEFINER function here.
-- Every one of them is reached from a screen that requires a session —
-- including complete_onboarding_atomic, which runs after OTP verification,
-- not before it (RootNavigator only mounts OnboardingScreen once the session
-- is live). Checked screen by screen, not assumed.
--
-- Trigger functions are skipped for the reason given in the header.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    RAISE NOTICE 'revoked anon: %', r.sig;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';


-- ── Verification ───────────────────────────────────────────────
-- Nothing SECURITY DEFINER should be anon-callable except trigger functions:
--
--   SELECT p.proname
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prosecdef
--      AND p.prorettype <> 'trigger'::regtype
--      AND has_function_privilege('anon', p.oid, 'EXECUTE');
--   -- expect: zero rows
--
-- And over HTTP with the anon key, this must now be 401, not 200:
--
--   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
--     "$URL/rest/v1/rpc/auth_user_id_by_phone" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H 'Content-Type: application/json' -d '{"p_phone":"915555555555"}'


-- ── Rollback ───────────────────────────────────────────────────
-- Restores the hole. Only if a grant here turns out to have broken a caller
-- that was missed — and then fix that caller rather than leaving this open.
-- GRANT EXECUTE ON FUNCTION public.decrement_wallet_balance_if_sufficient(uuid,numeric,text,text,text) TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.tag_wallet_debit_to_order(uuid,bigint)                              TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.auth_user_id_by_phone(text)                                         TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.increment_wallet_balance(uuid,numeric,text,text,text)               TO anon;
-- GRANT EXECUTE ON FUNCTION public.assign_addresses_to_hub(integer)                                    TO anon;
-- (and re-run rpc_atomic_increments.sql / serviceability_server_side.sql to
--  drop the two body guards added above)
