-- ═══════════════════════════════════════════════════════════════════════
-- 1stOne F1 — two ungated functions, sixteen unpinned ones  (2026-08-17)
--
-- Pure hardening. Nothing here changes a flow, a price, a date, a screen or
-- any decision the app makes. Every legitimate caller behaves identically;
-- only illegitimate ones are refused.
--
-- ── §1  TWO FUNCTIONS ANY SIGNED-IN CUSTOMER COULD CALL ────────────────
--
-- `assign_hub_operator` and `assign_hub_to_address_ids` are SECURITY DEFINER
-- (so they bypass RLS) and were EXECUTABLE by `authenticated` with no role
-- check of their own. Twenty-five sibling functions already gate themselves;
-- these two were simply missed.
--
-- REPRODUCED 2026-08-17 as a real plain customer (Customer One,
-- 915111111111), by impersonation — never as superuser, which bypasses RLS
-- and would have shown nothing wrong:
--
--   assign_hub_operator(19, self, NULL)
--     → succeeded. profiles.assigned_hub_id became 19 AND hub 19's
--       staff_user_id was overwritten to the caller.
--   assign_hub_to_address_ids(21, ARRAY[2])
--     → succeeded against an address owned by a DIFFERENT customer, wiping
--       its zone_id. The same UPDATE issued directly is correctly refused by
--       RLS (0 rows) — the function was the way around it.
--
-- WHY THE FIRST ONE MATTERS MOST. `profiles.assigned_hub_id` is a JWT claim.
-- On the caller's next token refresh they become a hub operator: able to read
-- and update every order routed through that hub, see those customers'
-- addresses, and raise a commission claim. It is also a column the project's
-- own rules say a client must never write.
--
-- THE GATE IS COPIED, NOT INVENTED. `auth.uid() IS NOT NULL AND …` is the
-- house pattern (see `assign_addresses_to_hub`, same screen, same job): with
-- no JWT — a cron job, the service role, a psql session — the check is
-- skipped, so server-side and maintenance callers are unaffected.
--
-- It reads `profiles.role` rather than the JWT claim, which is the stronger of
-- the two patterns present in this schema (`demote_employee`,
-- `admin_undelivered_order_ids`) and means a stale token cannot grant access.
-- No legitimate caller notices the difference; both are 'admin' for an admin.
--
-- ── §2  SIXTEEN SECURITY DEFINER FUNCTIONS WITH A MUTABLE search_path ──
--
-- A definer function without a pinned search_path resolves unqualified names
-- using the CALLER's path, which is the standard privilege-escalation shape
-- and what Supabase's own linter flags. The list includes the money path:
-- `increment_wallet_balance`, `decrement_wallet_balance_if_sufficient`,
-- `mark_order_paid`, `complete_wallet_topup`.
--
-- DONE WITH `ALTER FUNCTION … SET search_path`, NOT by re-creating bodies.
-- That is the whole point: not one line of any function body is touched, so
-- there is nothing to get wrong in sixteen re-transcriptions. It is also
-- reversible with RESET.
--
-- Functions that reach `net.` or `vault.` get that schema appended, matching
-- `advance_orders_status`, which already carries `'public','net'`. Every such
-- reference in these bodies is already schema-qualified, so `public` alone
-- would do — the extra entry is belt and braces on the kitchen-push path,
-- which is a known silent-failure area and not one to be clever with.
--
-- ── §3  THREE TEST-HARNESS TABLES WITH RLS OFF, IN PRODUCTION ──────────
--
-- `seed_360_registry`, `seed_360_run` and `seed_360_wallet_snapshot` are
-- bookkeeping for `supabase/tests/seed_360.sql`. They were the only tables in
-- the schema with row-level security disabled, which means they were readable
-- and writable through the API by any signed-in user.
--
-- Enabled with NO policies, exactly like `app_config` — unreachable through
-- PostgREST, while the harness (which runs as the service role / postgres,
-- both of which bypass RLS) keeps working untouched.
--
-- DRY-RUN THIS INSIDE BEGIN … ROLLBACK FIRST. There is one database; it is
-- development, preview and production at once.
--
-- Deploy: supabase db query --linked --file supabase/sql/harden_privileged_functions.sql
-- Idempotent — re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════


-- ── §1a  assign_hub_operator ──────────────────────────────────────────
--
-- Body below the gate is byte-for-byte what was deployed. REPLACE, never
-- DROP: the live grant is what it is, and a dropped-and-recreated function
-- comes back with EXECUTE to PUBLIC.
CREATE OR REPLACE FUNCTION public.assign_hub_operator(
  p_hub_id      BIGINT,
  p_new_user_id UUID DEFAULT NULL::uuid,
  p_old_user_id UUID DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;


-- ── §1b  assign_hub_to_address_ids ────────────────────────────────────
--
-- Was LANGUAGE sql, which has nowhere to put a gate — hence plpgsql. The
-- UPDATE is unchanged. Signature and return type are unchanged, so
-- CREATE OR REPLACE is legal and no caller is affected.
--
-- NOT DROPPED, though nothing in the app calls it any more (its screen moved
-- to the ray-cast path in `serviceability_server_side.sql`). Removing a
-- function is a structural change; closing a hole is not, and only the second
-- one was asked for.
CREATE OR REPLACE FUNCTION public.assign_hub_to_address_ids(
  p_hub_id      INTEGER,
  p_address_ids INTEGER[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;


-- ── §2  Pin search_path on every unpinned SECURITY DEFINER function ───
DO $$
DECLARE r RECORD; v_path TEXT; v_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid)   AS args,
           pg_get_functiondef(p.oid) ~ 'net\.'         AS uses_net,
           pg_get_functiondef(p.oid) ~ 'vault\.'       AS uses_vault
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%'
      )
    ORDER BY p.proname
  LOOP
    v_path := 'public'
           || CASE WHEN r.uses_net   THEN ', net'   ELSE '' END
           || CASE WHEN r.uses_vault THEN ', vault' ELSE '' END;
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = %s', r.proname, r.args, v_path);
    RAISE NOTICE 'pinned %(%) -> %', r.proname, r.args, v_path;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '§2 pinned % function(s)', v_count;
END $$;


-- ── §3  Lock the seed-harness tables ─────────────────────────────────
-- No policies, deliberately: unreachable through the API, untouched for
-- postgres / service_role, which is all the harness ever runs as.
ALTER TABLE public.seed_360_registry        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seed_360_run             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seed_360_wallet_snapshot ENABLE ROW LEVEL SECURITY;


-- ── §4  Assertions — these raise, so a failure cannot be skim-read ───
DO $$
DECLARE v_unpinned INT; v_rls_off INT; v_ungated INT;
BEGIN
  SELECT count(*) INTO v_unpinned
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%');
  IF v_unpinned > 0 THEN
    RAISE EXCEPTION 'FAILED — % definer function(s) still have a mutable search_path', v_unpinned;
  END IF;

  SELECT count(*) INTO v_rls_off
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_rls_off > 0 THEN
    RAISE EXCEPTION 'FAILED — % table(s) still have row-level security off', v_rls_off;
  END IF;

  SELECT count(*) INTO v_ungated
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('assign_hub_operator', 'assign_hub_to_address_ids')
    AND pg_get_functiondef(p.oid) NOT LIKE '%not permitted%';
  IF v_ungated > 0 THEN
    RAISE EXCEPTION 'FAILED — % of the two functions still carries no gate', v_ungated;
  END IF;

  RAISE NOTICE 'OK — 0 unpinned definer functions, 0 tables without RLS, both functions gated';
END $$;

-- Report: nothing should be listed under either heading.
SELECT 'still_unpinned' AS finding, p.proname AS detail
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%')
UNION ALL
SELECT 'rls_still_off', c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;


-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK
--
--   -- §1: re-apply the ungated bodies from add_assign_hub_operator_rpc.sql
--   --     and fix_assign_hub_operator_nullable.sql. Only do this knowing it
--   --     re-opens the escalation proved above.
--
--   -- §2: per function —
--   --   ALTER FUNCTION public.<name>(<args>) RESET search_path;
--
--   -- §3:
--   ALTER TABLE public.seed_360_registry        DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.seed_360_run             DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.seed_360_wallet_snapshot DISABLE ROW LEVEL SECURITY;
-- ═══════════════════════════════════════════════════════════════════════
