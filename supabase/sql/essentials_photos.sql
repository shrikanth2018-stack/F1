-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Essentials photos (2026-08-01)
--
-- The essentials half of the catalogue photo work. Mirrors
-- menu_item_photos.sql: same three columns, same fixed-path replace rule,
-- same render-endpoint delivery. Read that file's header for the reasoning —
-- only the differences are recorded here.
--
-- SCOPE: ADMIN UPLOADS ONLY, deliberately.
--
-- Essentials differ from the food menu in one way that matters: a row may be
-- owned by a VENDOR (`essentials_catalog.vendor_id`), and vendors are
-- customer-role profiles, not admins. Letting them write here would put
-- unreviewed, customer-visible imagery live the instant they tap upload.
--
-- The agreed design is a review gate: vendor uploads land in a SEPARATE
-- PRIVATE bucket and only move to this public one when an admin approves.
-- That work is not in this file. Until it ships, the policies below grant
-- writes to admins only, which is a safe base to extend — adding the vendor
-- path later means adding policies, not loosening these.
--
-- A vendor-owned row simply has no photo until then and renders the fallback
-- icon, which is the honest state: we should not publish a picture on a
-- vendor's behalf as though they supplied it.
--
-- SEPARATE BUCKET from menu-photos, for the same reason. Their write rules
-- diverge the moment the gate lands; one bucket would mean one policy set
-- doing both jobs, and a mistake in the vendor branch would hand vendors
-- write access to the food menu.
--
-- `description` also lands here. `EssentialItem.description` has been
-- declared in src/types/catalog.ts and rendered by ItemRows.tsx since the
-- essentials module shipped, but the column never existed — that branch has
-- never once displayed. Same phantom field the menu items had.
--
-- Deploy: supabase db query --linked --file supabase/sql/essentials_photos.sql
-- Idempotent. Safe to re-run.
-- Requires: menu_item_photos.sql (for public.is_admin() grants).
-- Rollback: see the bottom of this file.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Columns ─────────────────────────────────────────────────

ALTER TABLE public.essentials_catalog
  ADD COLUMN IF NOT EXISTS image_path       TEXT,
  ADD COLUMN IF NOT EXISTS image_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS description      TEXT;

COMMENT ON COLUMN public.essentials_catalog.image_path IS
  'Path inside the essentials-photos bucket, e.g. essentials-photos/3.jpg. '
  'Not a URL — the client builds a resized URL via the storage render '
  'endpoint. Set only by an admin until the vendor review gate ships.';
COMMENT ON COLUMN public.essentials_catalog.image_updated_at IS
  'Set on every photo upload. Appended as ?v=<epoch> to bust the CDN cache, '
  'which is necessary because the object path is fixed per item.';
COMMENT ON COLUMN public.essentials_catalog.description IS
  'Short customer-facing line under the item name on the Home screen.';

-- ── 2. Bucket ──────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'essentials-photos',
  'essentials-photos',
  TRUE,
  8388608,                                              -- 8 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 3. Storage policies ────────────────────────────────────────
-- Read: everyone. Write: admins only (see the scope note above).
--
-- INSERT *and* UPDATE are both required — the storage API's upsert path
-- inserts a new object or updates the existing row depending on whether the
-- key is already present. Granting only INSERT makes the SECOND upload of a
-- photo fail, which is exactly the case that matters for a replace rule.

DROP POLICY IF EXISTS essentials_photos_public_read ON storage.objects;
CREATE POLICY essentials_photos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'essentials-photos');

DROP POLICY IF EXISTS essentials_photos_admin_insert ON storage.objects;
CREATE POLICY essentials_photos_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'essentials-photos' AND public.is_admin());

DROP POLICY IF EXISTS essentials_photos_admin_update ON storage.objects;
CREATE POLICY essentials_photos_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'essentials-photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'essentials-photos' AND public.is_admin());

DROP POLICY IF EXISTS essentials_photos_admin_delete ON storage.objects;
CREATE POLICY essentials_photos_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'essentials-photos' AND public.is_admin());

-- NOTE for whoever builds the vendor gate: do NOT add a vendor branch to the
-- policies above. Vendor uploads belong in a private pending bucket, and the
-- ownership test must live in a SECURITY DEFINER function (mirroring
-- vendor_ids_visible_to_me) — an inline EXISTS over `vendors` in a policy is
-- evaluated as the calling user and is exactly what silently denied every
-- customer in the July 2026 vendor-visibility outage.

-- ── Rollback ───────────────────────────────────────────────────
-- DROP POLICY IF EXISTS essentials_photos_public_read   ON storage.objects;
-- DROP POLICY IF EXISTS essentials_photos_admin_insert  ON storage.objects;
-- DROP POLICY IF EXISTS essentials_photos_admin_update  ON storage.objects;
-- DROP POLICY IF EXISTS essentials_photos_admin_delete  ON storage.objects;
-- DELETE FROM storage.objects WHERE bucket_id = 'essentials-photos';
-- DELETE FROM storage.buckets WHERE id = 'essentials-photos';
-- ALTER TABLE public.essentials_catalog
--   DROP COLUMN IF EXISTS image_path,
--   DROP COLUMN IF EXISTS image_updated_at,
--   DROP COLUMN IF EXISTS description;
