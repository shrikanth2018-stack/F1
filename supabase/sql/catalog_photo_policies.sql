-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Catalogue photo write policies (2026-08-01)
--
-- Supersedes the storage policies in menu_item_photos.sql §3 and
-- essentials_photos.sql §3. Same policy NAMES on purpose, so this file
-- replaces them rather than adding a second permissive policy alongside —
-- storage policies OR together, so a looser leftover would still grant.
--
-- TWO PROBLEMS THIS FIXES.
--
-- 1. THE BUCKET AND THE TABLE DISAGREED ABOUT WHO MAY WRITE.
--
--      storage.objects   is_admin()
--      menu_items        is_admin() AND has_branch_access(branch_id)
--
--    So a branch-scoped admin acting on another branch's item passed the
--    bucket and failed the table. An UPDATE that RLS refuses is not an error —
--    it matches zero rows and returns success — so the app uploaded the file,
--    reported nothing, and the photo never appeared. The client now checks the
--    affected row (catalogPhotoUpload.ts), and this file stops the upload
--    happening at all. Both halves matter: one gives an honest message, the
--    other stops a file being written by someone with no business writing it.
--
-- 2. VENDORS COULD NOT SET THEIR OWN ITEM'S PHOTO.
--
--    Vendor items live in essentials_catalog with a vendor_id, and an approved
--    vendor already writes their own rows (essentials_vendor_write). They had
--    no way to add the picture, and the admin screen hid the control for their
--    rows, so a vendor listing could never show a photo at all. An approved
--    vendor may now write the object for their OWN items — and nobody else's.
--
--    Photos go live immediately. Review is coming with the full vendor listing
--    approval flow, which will gate the whole listing rather than the picture
--    alone; this file is the layer that will enforce it when it lands.
--
-- WHY A SECURITY DEFINER FUNCTION AND NOT AN INLINE EXISTS.
--
-- A policy expression runs as the CALLING user, so every table it touches
-- applies its own RLS. has_branch_access() reads feature_flags, and the vendor
-- test reads vendors — a customer can read neither. Inlining would have
-- silently denied everyone, which is exactly the July 2026 vendor-visibility
-- outage (vendors_fixes_03_visibility.sql). The helper below runs as its owner
-- and returns a boolean, mirroring vendor_ids_visible_to_me().
--
-- NEVER verify these policies with a superuser query — it bypasses RLS and
-- will confirm a policy that denies everyone. Impersonate: set_config on
-- request.jwt.claims plus SET LOCAL ROLE authenticated. See §Verification.
--
-- Deploy: supabase db query --linked --file supabase/sql/catalog_photo_policies.sql
-- Idempotent. Safe to re-run.
-- Requires: menu_item_photos.sql and essentials_photos.sql applied first.
-- Rollback: see the bottom of this file.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. May the caller write this object? ───────────────────────
-- p_key is the object key WITHIN the bucket — '12.jpg', not
-- 'menu-photos/12.jpg'. That is what storage.objects.name holds.

CREATE OR REPLACE FUNCTION public.catalog_photo_writable(p_bucket TEXT, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id INTEGER;
  v_branch  INTEGER;
  v_vendor  INTEGER;
BEGIN
  -- The key is the item id with a fixed .jpg extension, and nothing else is
  -- a legitimate write. Capped at 9 digits so the cast below cannot overflow
  -- INTEGER and raise instead of returning false.
  IF p_key !~ '^[0-9]{1,9}\.jpg$' THEN
    RETURN FALSE;
  END IF;
  v_item_id := split_part(p_key, '.', 1)::INTEGER;

  -- ── Food menu: admins only, scoped to their branch ──
  IF p_bucket = 'menu-photos' THEN
    SELECT branch_id INTO v_branch
      FROM public.menu_items WHERE id = v_item_id;
    -- No row means no item to illustrate. Refusing keeps the bucket free of
    -- files nothing points at, and blocks writing to an id before it exists.
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

    -- The team can set or take down any picture in their branch, including a
    -- vendor's. That is the moderation path — a vendor photo reaches
    -- customers immediately, so someone has to be able to remove a bad one.
    IF public.is_admin() AND public.has_branch_access(v_branch) THEN
      RETURN TRUE;
    END IF;

    -- The owning vendor, and only while approved. Mirrors the row-level test
    -- in essentials_vendor_write so the file and the row it belongs to are
    -- governed by the same rule.
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
$$;

COMMENT ON FUNCTION public.catalog_photo_writable(TEXT, TEXT) IS
  'May the current user write this catalogue photo object? Applies the same branch test as the catalogue tables, plus vendor ownership for essentials. SECURITY DEFINER because the storage policy that calls it runs as the caller, who can read neither feature_flags nor vendors.';

REVOKE ALL   ON FUNCTION public.catalog_photo_writable(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_photo_writable(TEXT, TEXT) TO authenticated;

-- ── 2. Menu photo policies ─────────────────────────────────────
-- Read stays public and unchanged: these are pictures of food on a menu, and
-- signed URLs would defeat CDN caching for no security gain.
--
-- INSERT *and* UPDATE are both required — the storage API's upsert path
-- inserts a new object or updates the existing row depending on whether the
-- key is already present. Granting only INSERT makes the SECOND upload of a
-- photo fail, which is exactly the case a replace rule cares about.

DROP POLICY IF EXISTS menu_photos_admin_insert ON storage.objects;
CREATE POLICY menu_photos_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'menu-photos'
    AND public.catalog_photo_writable('menu-photos', name)
  );

DROP POLICY IF EXISTS menu_photos_admin_update ON storage.objects;
CREATE POLICY menu_photos_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'menu-photos'
    AND public.catalog_photo_writable('menu-photos', name)
  )
  WITH CHECK (
    bucket_id = 'menu-photos'
    AND public.catalog_photo_writable('menu-photos', name)
  );

DROP POLICY IF EXISTS menu_photos_admin_delete ON storage.objects;
CREATE POLICY menu_photos_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'menu-photos'
    AND public.catalog_photo_writable('menu-photos', name)
  );

-- ── 3. Essentials photo policies ───────────────────────────────

DROP POLICY IF EXISTS essentials_photos_admin_insert ON storage.objects;
CREATE POLICY essentials_photos_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'essentials-photos'
    AND public.catalog_photo_writable('essentials-photos', name)
  );

DROP POLICY IF EXISTS essentials_photos_admin_update ON storage.objects;
CREATE POLICY essentials_photos_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'essentials-photos'
    AND public.catalog_photo_writable('essentials-photos', name)
  )
  WITH CHECK (
    bucket_id = 'essentials-photos'
    AND public.catalog_photo_writable('essentials-photos', name)
  );

DROP POLICY IF EXISTS essentials_photos_admin_delete ON storage.objects;
CREATE POLICY essentials_photos_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'essentials-photos'
    AND public.catalog_photo_writable('essentials-photos', name)
  );

NOTIFY pgrst, 'reload schema';

-- ── Verification ───────────────────────────────────────────────
-- Run as the service role; the function is SECURITY DEFINER so its own
-- reads are fine, but is_admin()/auth.uid() read the JWT claims GUC, which
-- is what has to be faked. Substitute real ids.
--
-- -- An admin, on an item in their branch → true
-- SELECT set_config('request.jwt.claims',
--   '{"sub":"<admin-uuid>","user_role":"admin","branch_id":1}', TRUE);
-- SELECT public.catalog_photo_writable('menu-photos', '12.jpg');
--
-- -- The same admin, on an item in ANOTHER branch → false
-- SELECT public.catalog_photo_writable('menu-photos', '<other-branch-item>.jpg');
--
-- -- An approved vendor, on their own item → true; on a 1stOne item → false
-- SELECT set_config('request.jwt.claims',
--   '{"sub":"<vendor-owner-uuid>","user_role":"customer"}', TRUE);
-- SELECT public.catalog_photo_writable('essentials-photos', '<their-item>.jpg');
-- SELECT public.catalog_photo_writable('essentials-photos', '<our-item>.jpg');
--
-- -- Junk keys and unknown ids → false
-- SELECT public.catalog_photo_writable('menu-photos', '../secret.jpg'),
--        public.catalog_photo_writable('menu-photos', '99999999.jpg');
--
-- Then, in the app: an admin must still be able to set a photo from Menu
-- Manager and Essentials Manager, and an approved vendor from My Store.

-- ── Rollback ───────────────────────────────────────────────────
-- Restores the previous admin-only-by-JWT policies from menu_item_photos.sql
-- and essentials_photos.sql. Vendors lose photo upload; branch scoping on the
-- bucket goes away.
--
-- DROP POLICY IF EXISTS menu_photos_admin_insert ON storage.objects;
-- CREATE POLICY menu_photos_admin_insert ON storage.objects
--   FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'menu-photos' AND public.is_admin());
-- DROP POLICY IF EXISTS menu_photos_admin_update ON storage.objects;
-- CREATE POLICY menu_photos_admin_update ON storage.objects
--   FOR UPDATE TO authenticated
--   USING      (bucket_id = 'menu-photos' AND public.is_admin())
--   WITH CHECK (bucket_id = 'menu-photos' AND public.is_admin());
-- DROP POLICY IF EXISTS menu_photos_admin_delete ON storage.objects;
-- CREATE POLICY menu_photos_admin_delete ON storage.objects
--   FOR DELETE TO authenticated
--   USING (bucket_id = 'menu-photos' AND public.is_admin());
-- DROP POLICY IF EXISTS essentials_photos_admin_insert ON storage.objects;
-- CREATE POLICY essentials_photos_admin_insert ON storage.objects
--   FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'essentials-photos' AND public.is_admin());
-- DROP POLICY IF EXISTS essentials_photos_admin_update ON storage.objects;
-- CREATE POLICY essentials_photos_admin_update ON storage.objects
--   FOR UPDATE TO authenticated
--   USING      (bucket_id = 'essentials-photos' AND public.is_admin())
--   WITH CHECK (bucket_id = 'essentials-photos' AND public.is_admin());
-- DROP POLICY IF EXISTS essentials_photos_admin_delete ON storage.objects;
-- CREATE POLICY essentials_photos_admin_delete ON storage.objects
--   FOR DELETE TO authenticated
--   USING (bucket_id = 'essentials-photos' AND public.is_admin());
-- DROP FUNCTION IF EXISTS public.catalog_photo_writable(TEXT, TEXT);
