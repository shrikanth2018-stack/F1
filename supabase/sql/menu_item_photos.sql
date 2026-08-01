-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Menu item photos (2026-08-01)
--
-- Adds a picture to a customer-facing menu item: one photo per item, shown
-- on the Home screen row and managed from the menu builder (CreateMenu +
-- Menu Manager).
--
-- THREE COLUMNS on menu_items:
--
--   image_path        Storage path INSIDE the bucket — 'menu-photos/12.jpg'.
--                     Deliberately NOT a full URL. src/utils/assets.ts exists
--                     precisely so no project-ref ever lives in code; storing
--                     absolute URLs on data rows would bake the ref into
--                     every row instead. The client also has to build
--                     DIFFERENT urls for the same photo (the render endpoint
--                     resizes on delivery), which a stored URL cannot do.
--
--   image_updated_at  Cache-buster. The object path is fixed per item so a
--                     re-upload overwrites in place — which means the URL
--                     never changes and the Supabase CDN would serve the old
--                     bytes for up to an hour. The client appends ?v=<epoch>
--                     from this column. Set it on every upload.
--
--   description       Short human line under the item name ("Masala Dosa +
--                     Vada + Sheera"). NOTE: src/types/catalog.ts has claimed
--                     MenuItem.description existed since the two-stage
--                     builder shipped — it never did, so the render branch in
--                     ItemRows.tsx has never once fired. This makes the type
--                     honest. (The same file also declared image_url, which
--                     nothing referenced; it is replaced by image_path.)
--
-- All three are nullable. Every existing row keeps working, and an item
-- without a photo renders the current Ionicon in the same tile so the list
-- stays aligned.
--
-- ONE PHOTO PER ITEM, ENFORCED BY THE PATH. The object key is the menu item
-- id with a FIXED .jpg extension: 'menu-photos/{id}.jpg', uploaded with
-- upsert. A varying extension would leave {id}.jpg AND {id}.webp behind on a
-- format change — two objects for one item. Fixing the extension makes
-- replacement genuinely atomic: uploading a new picture destroys the old one
-- because it is literally the same object.
--
-- WHY A SEPARATE BUCKET (not the existing `assets`):
--   1. `assets` holds branding + the Privacy/Terms PDFs. Menu photos are
--      content, churned by admins; keeping them apart limits the blast
--      radius of a mistake in either.
--   2. `assets` has no size limit and no MIME allowlist. This one has both.
--   3. `assets` currently allows ANONYMOUS writes — see
--      assets_bucket_lockdown.sql, fixed separately.
--
-- ACCESS follows the app's existing admin pattern exactly: public.is_admin(),
-- which reads the user_role claim off the JWT (rls_policies.sql:35). It is
-- used here rather than an inline profiles lookup for the reason recorded in
-- vendors_fixes_03_visibility.sql — a policy expression runs as the CALLING
-- user, so any table it touches applies its own RLS and can silently deny
-- everyone. is_admin() reads auth.jwt() and touches no table at all, so it is
-- immune to that whole class of bug.
--
-- Deploy: paste into the Supabase SQL editor, or
--         supabase db query --linked --file supabase/sql/menu_item_photos.sql
-- Idempotent. Safe to re-run.
-- Rollback: see the bottom of this file.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Columns ─────────────────────────────────────────────────

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS image_path       TEXT,
  ADD COLUMN IF NOT EXISTS image_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS description      TEXT;

COMMENT ON COLUMN public.menu_items.image_path IS
  'Path inside the menu-photos bucket, e.g. menu-photos/12.jpg. Not a URL — '
  'the client builds a resized URL from it via the storage render endpoint.';
COMMENT ON COLUMN public.menu_items.image_updated_at IS
  'Set on every photo upload. Appended as ?v=<epoch> to bust the CDN cache, '
  'which is necessary because the object path is fixed per item.';
COMMENT ON COLUMN public.menu_items.description IS
  'Short customer-facing line under the item name on the Home screen.';

-- ── 2. Bucket ──────────────────────────────────────────────────
-- Public read: menu photos are shown to every signed-in customer and carry
-- nothing sensitive. Signed URLs would defeat CDN caching and cost a
-- round-trip per image for no security gain.
--
-- 8 MB ceiling: the admin uploader compresses at pick time but does NOT
-- resize (expo-image-manipulator is a native module and would cost a store
-- release), so an original can land around 1-2 MB. 8 MB is headroom, not a
-- target. Customers never download the original — the render endpoint serves
-- them a ~5 KB version.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'menu-photos',
  'menu-photos',
  TRUE,
  8388608,                                              -- 8 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 3. Storage policies ────────────────────────────────────────
-- ⚠ THE WRITE POLICIES BELOW ARE SUPERSEDED by
--   catalog_photo_policies.sql (2026-08-01), which reuses these exact policy
--   names. is_admin() alone was looser than the menu_items table policy
--   (which also tests has_branch_access), so a branch-scoped admin could
--   write the file and then silently fail to update the row.
--
--   RE-RUNNING THIS FILE REOPENS THAT GAP. Apply catalog_photo_policies.sql
--   again straight afterwards. Everything above §3 is still current.
--
-- Read: everyone. Write: admins only, via the app's existing is_admin().
--
-- INSERT *and* UPDATE are both required — the storage API's upsert path
-- inserts a new object or updates the existing row depending on whether the
-- key is already present. Granting only INSERT makes the second upload of a
-- photo fail, which is exactly the case that matters here.

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

DROP POLICY IF EXISTS menu_photos_public_read ON storage.objects;
CREATE POLICY menu_photos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'menu-photos');

DROP POLICY IF EXISTS menu_photos_admin_insert ON storage.objects;
CREATE POLICY menu_photos_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'menu-photos' AND public.is_admin());

DROP POLICY IF EXISTS menu_photos_admin_update ON storage.objects;
CREATE POLICY menu_photos_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'menu-photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'menu-photos' AND public.is_admin());

DROP POLICY IF EXISTS menu_photos_admin_delete ON storage.objects;
CREATE POLICY menu_photos_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'menu-photos' AND public.is_admin());

-- ── Rollback ───────────────────────────────────────────────────
-- DROP POLICY IF EXISTS menu_photos_public_read   ON storage.objects;
-- DROP POLICY IF EXISTS menu_photos_admin_insert  ON storage.objects;
-- DROP POLICY IF EXISTS menu_photos_admin_update  ON storage.objects;
-- DROP POLICY IF EXISTS menu_photos_admin_delete  ON storage.objects;
-- DELETE FROM storage.objects WHERE bucket_id = 'menu-photos';
-- DELETE FROM storage.buckets WHERE id = 'menu-photos';
-- ALTER TABLE public.menu_items
--   DROP COLUMN IF EXISTS image_path,
--   DROP COLUMN IF EXISTS image_updated_at,
--   DROP COLUMN IF EXISTS description;
