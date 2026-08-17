-- ═══════════════════════════════════════════════════════════════════════
-- 1stOne F1 — order_items keeps only the grants it needs  (2026-08-17)
--
-- `CLAUDE.md` says "a client cannot write `order_items` at all", and in effect
-- that is true. But it is true because of the POLICIES, not the grants — and
-- the grants are wider than the sentence implies:
--
--   authenticated   SELECT, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   anon            SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--
-- Policies present: `order_items_self` (SELECT), `order_items_insert` (INSERT),
-- `order_items_hub_op_select` (SELECT). **There is no UPDATE or DELETE policy.**
--
-- TESTED AS A REAL CUSTOMER BY IMPERSONATION on 2026-08-17 — never as
-- superuser, which bypasses RLS and would have shown nothing:
--
--   DELETE own order line   → 0 rows. Granted, but no policy, so RLS denies.
--   INSERT a free line      → permission denied (no grant to authenticated).
--   UPDATE the price to 0   → permission denied (no grant).
--   TRUNCATE order_items    → refused: "cannot truncate a table referenced in
--                             a foreign key constraint".
--
-- So nothing is exploitable today and this is not an incident. It is
-- defence-in-depth debris, and two pieces of it are worth removing:
--
--  1. TRUNCATE IS NOT SUBJECT TO ROW-LEVEL SECURITY AT ALL. It is refused today
--     only because `order_item_ratings.order_item_id` happens to reference the
--     table. That is luck, not design: restructure or drop that foreign key and
--     a signed-in user holds a grant that empties every order line in the
--     business. PostgREST does not expose TRUNCATE, so the reachable surface is
--     any future path that runs arbitrary SQL as `authenticated`.
--  2. `anon` HOLDING INSERT AND UPDATE IS POINTLESS. `auth.uid()` is NULL for
--     anon, so the INSERT policy can never pass, and there is no UPDATE policy
--     for it to pass. The grants exist and buy nothing.
--
-- WHAT STILL WORKS AFTERWARDS, and why nothing breaks:
--   • `place_order_atomic` and `generate_daily_manifest` write order_items as
--     the definer / service_role, which this file does not touch.
--   • Customers and staff READ order_items through `order_items_self` and
--     `order_items_hub_op_select` — SELECT is untouched.
--   • `order_items_insert` keeps its policy. The grant to `authenticated` was
--     already absent, so client insert was already impossible; removing the
--     anon grant changes nothing a client could do.
--   • Nothing in `src/` writes order_items. `useReorder` only reads it.
--
-- REHEARSED on a throwaway copy of the live schema before it was applied:
--   npm run schema:rehearse supabase/sql/order_items_revoke_surplus_grants.sql
--
-- Deploy: supabase db query --linked --file supabase/sql/order_items_revoke_surplus_grants.sql
-- Idempotent — REVOKE of an absent privilege is a no-op, so re-running is safe.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Take back what no policy will ever let through ─────────────────
--
-- STATED AS THE END STATE, NOT AS THE DELTA FROM PRODUCTION. `authenticated`
-- does not hold INSERT or UPDATE on the live database, so naming them here is a
-- no-op there — but it is NOT a no-op on a rebuilt copy. The Supabase Postgres
-- image grants ALL on a newly created table via default privileges, and a
-- pg_dump restore only ever ADDS grants, so a database rebuilt from
-- supabase/schema/live_schema.sql starts with more privilege than production
-- has. The rehearsal caught exactly that. Revoking the full set makes this file
-- produce the same answer wherever it runs.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_items FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_items FROM authenticated;

-- REFERENCES and TRIGGER are left alone deliberately. They let a role create a
-- foreign key to, or a trigger on, this table — neither is reachable through
-- PostgREST, and both are granted across this schema by Supabase's default
-- privileges. Removing them here alone would make order_items inconsistent with
-- every other table for no gain.


-- ── 2. Report — read this, not the exit code ──────────────────────────

-- What each client role may now do. Expect:
--   anon           SELECT (+ REFERENCES, TRIGGER)
--   authenticated  SELECT (+ REFERENCES, TRIGGER)
--   service_role   unchanged, full
SELECT grantee,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name   = 'order_items'
  AND grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY grantee
ORDER BY grantee;

-- Assertions. These raise rather than print, so a failure cannot be skim-read.
DO $$
DECLARE v_bad TEXT;
BEGIN
  -- No client role may hold a write privilege any more.
  SELECT string_agg(grantee || ':' || privilege_type, ', ')
    INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'order_items'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAILED — a client role still holds a write grant: %', v_bad;
  END IF;

  -- Reading must survive. Losing SELECT here would blank every order detail
  -- screen, the printed slip and the vendor board.
  IF NOT has_table_privilege('authenticated', 'public.order_items', 'SELECT') THEN
    RAISE EXCEPTION 'FAILED — authenticated lost SELECT on order_items';
  END IF;
  IF NOT has_table_privilege('anon', 'public.order_items', 'SELECT') THEN
    RAISE EXCEPTION 'FAILED — anon lost SELECT on order_items';
  END IF;

  -- The server still has to be able to write orders.
  IF NOT has_table_privilege('service_role', 'public.order_items', 'INSERT') THEN
    RAISE EXCEPTION 'FAILED — service_role lost INSERT on order_items';
  END IF;

  RAISE NOTICE 'OK — clients read only; service_role unchanged';
END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK (restores exactly what was there on 2026-08-17)
--
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.order_items TO anon;
--   GRANT DELETE, TRUNCATE                 ON public.order_items TO authenticated;
--
-- Only do this knowing it re-opens the TRUNCATE described above.
-- ═══════════════════════════════════════════════════════════════════════
