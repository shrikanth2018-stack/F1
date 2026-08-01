-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Lock down the `assets` storage bucket (2026-08-01)
--
-- THE HOLE. The `assets` bucket shipped with four dashboard-generated
-- policies — "general 1bqp9qb_0" .. "_3" — granting SELECT, INSERT, UPDATE
-- and DELETE to the Postgres role `public`. `public` is the pseudo-role every
-- other role inherits, so that includes `anon`: the unauthenticated role
-- whose key is compiled into the shipped APK.
--
-- Verified 2026-08-01 against production using nothing but the anon key from
-- .env: PUT  /storage/v1/object/assets/<file>  → 200
--       DELETE /storage/v1/object/assets/<file> → 200
-- (probe file removed immediately; bucket contents unchanged).
--
-- So anyone who pulled the anon key out of the app binary could overwrite or
-- delete logo.png, banner.png, the login background, the landing hero, and
-- Privacy-Policy.pdf / Terms.pdf. Nothing in the app has ever depended on
-- that being possible — every writer is an admin screen:
--
--   LoginBgScreen             login_bg_*.jpg, landing_hero_*.jpg  (admin)
--   SpecialOfferBannerScreen  banner_*.jpg                        (admin)
--
-- and the only reader is assetUrl() (src/utils/assets.ts), which builds a
-- public URL and needs no privileges at all.
--
-- THE FIX. Keep read public — these files are branding and public policy
-- documents, and the landing site at 1stone.in fetches the hero anonymously,
-- so anonymous READ is load-bearing and must stay. Gate the three write verbs
-- on public.is_admin(), the same JWT-claim helper used everywhere else
-- (rls_policies.sql:35) and now by menu_item_photos.sql.
--
-- This is a pre-existing hole, unrelated to the menu photo feature — kept in
-- its own file so it can be reviewed and rolled back on its own.
--
-- Deploy: supabase db query --linked --file supabase/sql/assets_bucket_lockdown.sql
-- Idempotent. Safe to re-run.
--
-- AFTER APPLYING, re-test in the app: Manage → Marketing → Banners &
-- Backgrounds must still upload as an admin. If an upload starts failing with
-- "new row violates row-level security policy", the signed-in user's JWT is
-- missing the user_role claim — re-login refreshes it.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Remove the permissive dashboard policies ────────────────
-- Named with a space, hence the quoting. IF EXISTS so a re-run is silent.

DROP POLICY IF EXISTS "general 1bqp9qb_0" ON storage.objects;   -- SELECT to public
DROP POLICY IF EXISTS "general 1bqp9qb_1" ON storage.objects;   -- INSERT to public
DROP POLICY IF EXISTS "general 1bqp9qb_2" ON storage.objects;   -- UPDATE to public
DROP POLICY IF EXISTS "general 1bqp9qb_3" ON storage.objects;   -- DELETE to public

-- ── 2. Read stays open ─────────────────────────────────────────
-- Anonymous read is required: the login screen renders the background before
-- anyone has signed in, and the landing site is not authenticated at all.

DROP POLICY IF EXISTS assets_public_read ON storage.objects;
CREATE POLICY assets_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'assets');

-- ── 3. Writes are admin-only ───────────────────────────────────
-- Both INSERT and UPDATE: the uploaders use upsert semantics, which lands on
-- one or the other depending on whether the key already exists.

DROP POLICY IF EXISTS assets_admin_insert ON storage.objects;
CREATE POLICY assets_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'assets' AND public.is_admin());

DROP POLICY IF EXISTS assets_admin_update ON storage.objects;
CREATE POLICY assets_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'assets' AND public.is_admin())
  WITH CHECK (bucket_id = 'assets' AND public.is_admin());

-- DELETE matters as much as INSERT here: the uploaders delete the previous
-- file after a successful replace, so admins genuinely need it — and it is
-- exactly the verb that made the open policy dangerous.
DROP POLICY IF EXISTS assets_admin_delete ON storage.objects;
CREATE POLICY assets_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'assets' AND public.is_admin());

-- ── Rollback ───────────────────────────────────────────────────
-- Restores the hole. Only for an emergency where admin uploads are broken
-- and a banner must go out immediately.
--
-- DROP POLICY IF EXISTS assets_public_read  ON storage.objects;
-- DROP POLICY IF EXISTS assets_admin_insert ON storage.objects;
-- DROP POLICY IF EXISTS assets_admin_update ON storage.objects;
-- DROP POLICY IF EXISTS assets_admin_delete ON storage.objects;
-- CREATE POLICY "general 1bqp9qb_0" ON storage.objects
--   FOR SELECT TO public USING (bucket_id = 'assets');
-- CREATE POLICY "general 1bqp9qb_1" ON storage.objects
--   FOR INSERT TO public WITH CHECK (bucket_id = 'assets');
-- CREATE POLICY "general 1bqp9qb_2" ON storage.objects
--   FOR UPDATE TO public USING (bucket_id = 'assets');
-- CREATE POLICY "general 1bqp9qb_3" ON storage.objects
--   FOR DELETE TO public USING (bucket_id = 'assets');
