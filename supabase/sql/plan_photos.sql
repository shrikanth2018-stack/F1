-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — photos for subscription plans
--
-- The Subscribe tab was the only one of the three showing no pictures, which
-- read as unfinished rather than different. Same shape as menu_item_photos
-- and essentials_photos: two columns on the row, a public-read bucket, and
-- writes gated on is_admin().
--
-- ITS OWN BUCKET, NOT A SHARED ONE. A photo lives at `<bucket>/<id>.jpg`, and
-- the three id sequences are independent — plan 26, menu item 26 and
-- essential 26 are different things. Sharing a bucket would have them
-- overwrite each other's pictures, silently and in whichever order they were
-- uploaded.
--
-- ADMIN-BUILT PLANS ONLY, in practice. A custom plan is composed by a
-- customer and has no photo; the browse list excludes customs anyway, so the
-- fallback icon is what a plan without a picture shows and that is the normal
-- state until an admin adds one.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- After deploying: npm run supabase:gen-types
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS image_path       TEXT,
  ADD COLUMN IF NOT EXISTS image_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.subscription_plans.image_path IS
  'Storage key of the plan photo — plan-photos/<id>.jpg. Build a URL with photoUrl (src/utils/catalogPhoto.ts).';
COMMENT ON COLUMN public.subscription_plans.image_updated_at IS
  'Stamped on every upload; busts the CDN cache for a replaced photo.';

-- ── The bucket ─────────────────────────────────────────────────
-- Public read: these are pictures of food on a storefront. 8 MB and an image
-- allowlist so an upload cannot become a file drop.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'plan-photos', 'plan-photos', TRUE, 8388608,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Policies ───────────────────────────────────────────────────
-- Read is public because the bucket is; write is admin-only. Four policies
-- rather than one FOR ALL, so a future edit to one verb cannot quietly widen
-- the others (see rls-write-gaps: FOR ALL with no WITH CHECK let customers
-- write three tables).
DROP POLICY IF EXISTS plan_photos_public_read ON storage.objects;
CREATE POLICY plan_photos_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'plan-photos');

DROP POLICY IF EXISTS plan_photos_admin_insert ON storage.objects;
CREATE POLICY plan_photos_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plan-photos' AND public.is_admin());

DROP POLICY IF EXISTS plan_photos_admin_update ON storage.objects;
CREATE POLICY plan_photos_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'plan-photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'plan-photos' AND public.is_admin());

DROP POLICY IF EXISTS plan_photos_admin_delete ON storage.objects;
CREATE POLICY plan_photos_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'plan-photos' AND public.is_admin());

-- The row's own columns are admin-written. Grants on this table are
-- per-column, so a new one has to be named or the admin's upload records the
-- file and never points the row at it — and a refused RLS write is not an
-- error, so it would look exactly like a save.
GRANT UPDATE (image_path, image_updated_at) ON public.subscription_plans TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Rollback ───────────────────────────────────────────────────
--   DELETE FROM storage.objects WHERE bucket_id = 'plan-photos';
--   DELETE FROM storage.buckets WHERE id = 'plan-photos';
--   ALTER TABLE public.subscription_plans
--     DROP COLUMN IF EXISTS image_path, DROP COLUMN IF EXISTS image_updated_at;
