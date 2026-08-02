-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Vendor listing approval (2026-08-02)
--
-- Nothing a vendor lists reaches a customer until someone here approves it,
-- and nothing a vendor touches can change what we pay or what we earn.
--
-- WHAT IS GATED, AND WHAT DELIBERATELY IS NOT
--
--   Gated      a new listing; and later edits to name, price, unit, cycle,
--              description or photo on a listing that is already selling.
--   Instant    is_active and daily_cap.
--
-- The carve-out is not an oversight. Those two are how a vendor says "I have
-- run out" or "only 20 tomorrow". Making availability wait for approval means
-- customers buy goods the vendor already knows they cannot supply — an
-- overselling bug with a delivery failure at the end of it. Neither field
-- changes what the listing IS, only whether it can be bought today.
--
-- HOW AN EDIT WAITS WITHOUT TAKING THE ITEM OFF SALE
--
-- A new listing is a row in essentials_catalog with listing_status='draft' —
-- invisible to customers, but a real row, which matters because the photo key
-- is essentials-photos/{id}.jpg and a picture cannot be attached to a row that
-- does not exist yet. That single fact is why listings are staged in place
-- rather than in a separate table: a staging table would need its own photo
-- scheme and a copy-on-approve step, and approval would have to recreate the
-- row that the cart, cycle tagging, GST carve-out, kitchen exclusion and the
-- earnings trigger all already key off.
--
-- An edit to a row that is ALREADY approved cannot be written in place —
-- the live values are still selling. Those go to vendor_listing_changes as
-- proposed values, applied to the row on approval. A proposed photo goes to
-- essentials-photos/pending/{id}.jpg so it cannot overwrite the live one.
--
-- ONE OPEN CHANGE PER ITEM, enforced by a unique index rather than by the
-- app. A second edit replaces the first; a vendor cannot build a queue of
-- pending changes for one item, and an admin never has to work out which of
-- three requests is current.
--
-- HOUSE BRAND IS NOT PART OF THIS. `vendor_cost` and `selling_model` are
-- untouched by every RPC below; the only thing this file does to vendor_cost
-- is revoke a vendor's ability to write it, which is a lockdown and not a
-- feature. House brand remains a separate, later, multi-branch piece of work.
--
-- THE STATUS RULE EXISTS TWICE, ON PURPOSE — the same shape as the vendor
-- zone rule. RLS covers browsing; the order builder runs as service-role and
-- bypasses RLS entirely, so `_shared/orderBuild.ts` re-checks listing_status
-- when it prices a cart. Change one, change the other.
--
-- Deploy: supabase db query --linked --file supabase/sql/vendor_listing_approval.sql
-- Idempotent. Safe to re-run.
-- Requires: vendors_schema.sql, vendors_fixes_03_visibility.sql,
--           catalog_photo_policies.sql.
-- Supersedes: the catalog_photo_writable() definition in
--           catalog_photo_policies.sql (extended here for the pending key).
-- Rollback: see the bottom of this file.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Listing status on the catalogue row ─────────────────────

ALTER TABLE public.essentials_catalog
  ADD COLUMN IF NOT EXISTS listing_status   TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by      UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- DEFAULT 'approved' is what makes this migration safe to run against a live
-- catalogue: every row that already exists — ours and the vendors' — keeps
-- selling. Only rows created through vendor_create_draft_listing() below
-- start life as 'draft'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'essentials_listing_status_allowed'
  ) THEN
    ALTER TABLE public.essentials_catalog
      ADD CONSTRAINT essentials_listing_status_allowed
      CHECK (listing_status IN ('draft', 'pending', 'approved', 'rejected'));
  END IF;
END $$;

COMMENT ON COLUMN public.essentials_catalog.listing_status IS
  'draft = vendor is still preparing it; pending = with us for review; approved = customer-visible; rejected = sent back. 1stOne''s own rows are always approved. Customers see approved only — enforced in RLS AND again in orderBuild.ts, which bypasses RLS.';

CREATE INDEX IF NOT EXISTS idx_essentials_listing_status
  ON public.essentials_catalog (listing_status)
  WHERE listing_status <> 'approved';

-- ── 2. Proposed changes to listings that are already selling ───

CREATE TABLE IF NOT EXISTS public.vendor_listing_changes (
  id               BIGSERIAL PRIMARY KEY,
  item_id          INTEGER NOT NULL REFERENCES public.essentials_catalog(id) ON DELETE CASCADE,
  vendor_id        BIGINT  NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  -- Proposed values, only for the fields a vendor may change. Read field by
  -- field on approval — never applied wholesale, so a key that should not be
  -- there cannot become a column write.
  proposed         JSONB   NOT NULL,
  -- TRUE when a new picture is waiting at pending/{item_id}.jpg.
  photo_pending    BOOLEAN NOT NULL DEFAULT FALSE,
  status           TEXT    NOT NULL DEFAULT 'pending',
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      UUID REFERENCES auth.users(id),
  rejection_reason TEXT,
  CONSTRAINT vendor_listing_changes_status_allowed
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- One open change per item, in the database rather than in the app. A second
-- edit REPLACES the first (the RPC deletes any open row before inserting), so
-- an admin is never shown three competing versions of one item.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_listing_changes_one_open
  ON public.vendor_listing_changes (item_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_vendor_listing_changes_pending
  ON public.vendor_listing_changes (submitted_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.vendor_listing_changes IS
  'Proposed edits to vendor listings that are already approved and selling. The live essentials_catalog row is untouched until an admin approves, so nothing goes off sale during review. New listings do NOT appear here — they are staged in place as listing_status=draft/pending.';

ALTER TABLE public.vendor_listing_changes ENABLE ROW LEVEL SECURITY;

-- The owning vendor reads their own; admins read their branch's. NOBODY
-- writes from the app — every row is created and settled by the SECURITY
-- DEFINER functions below, which is what stops a vendor approving themselves.
DROP POLICY IF EXISTS vendor_listing_changes_read ON public.vendor_listing_changes;
CREATE POLICY vendor_listing_changes_read ON public.vendor_listing_changes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.vendors v
            WHERE v.id = vendor_id AND v.owner_user_id = auth.uid())
    OR public.is_admin()
  );

REVOKE INSERT, UPDATE, DELETE ON public.vendor_listing_changes FROM authenticated, anon;
GRANT SELECT ON public.vendor_listing_changes TO authenticated;

-- ── 3. Lock vendors out of the platform's own columns ──────────
--
-- essentials_catalog carried a blanket GRANT ALL TO authenticated, and
-- essentials_vendor_write is FOR ALL, so an approved vendor could write EVERY
-- column of their own rows — including vendor_cost, which decides what we pay
-- them on a house-brand delivery, and now listing_status, which would let a
-- vendor approve their own listing.
--
-- Same treatment `vendors` already has: revoke the verb, grant back the
-- specific columns. Everything not named here is unwritable from any client,
-- admin included — admin changes go through the SECURITY DEFINER RPCs below,
-- exactly as admin_set_vendor_* works.
--
-- INSERT is revoked outright: a new vendor row must come from
-- vendor_create_draft_listing(), which forces vendor_id, branch_id and
-- listing_status rather than trusting what the client sent.

REVOKE INSERT, UPDATE ON public.essentials_catalog FROM authenticated, anon;

GRANT UPDATE (
  name, price, unit, cycle_id, description,
  daily_cap, is_active,
  image_path, image_updated_at,
  sort_order
) ON public.essentials_catalog TO authenticated;

-- Admins still insert their OWN (non-vendor) catalogue rows from Essentials
-- Manager. Granting INSERT back at column level would let a vendor insert
-- too — RLS decides WHICH rows, not whether the verb exists — so admin
-- inserts go through their own definer function instead (§7).

-- ── 4. Customers see approved listings only ────────────────────
-- Extends essentials_vendor_scope (vendors_fixes_03_visibility.sql). Still
-- RESTRICTIVE, so it ANDs with the permissive read-all policy that
-- rls_policies.sql recreates on every run.
--
-- The vendor's own branch deliberately has NO status test: a vendor must be
-- able to see their own drafts, pending items and rejections in My Store.
-- Staff and admin likewise see everything, or the review queue would be empty.

DROP POLICY IF EXISTS essentials_vendor_scope ON public.essentials_catalog;
CREATE POLICY essentials_vendor_scope ON public.essentials_catalog
  AS RESTRICTIVE
  FOR SELECT
  USING (
    -- 1stOne's own items — every row that existed before the vendor network
    vendor_id IS NULL
    -- Catalogue management and the review queue
    OR public.is_staff_or_admin()
    -- The vendor's own store screen, at every status
    OR EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = essentials_catalog.vendor_id
        AND v.owner_user_id = auth.uid()
    )
    -- The customer path: in a granted area AND signed off by us
    OR (
      essentials_catalog.listing_status = 'approved'
      AND essentials_catalog.vendor_id IN (
        SELECT f.vendor_id FROM public.vendor_ids_visible_to_me() f
      )
    )
  );

-- ── 5. Photo keys: allow a pending picture ─────────────────────
-- Supersedes the definition in catalog_photo_policies.sql. Same policies call
-- it, so they pick this up with no policy changes.
--
-- Two shapes are now legitimate: '{id}.jpg' (live) and 'pending/{id}.jpg' (a
-- proposed replacement awaiting review). The pending key is what stops an
-- edit's photo overwriting the picture customers are looking at right now.

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
$$;

REVOKE ALL   ON FUNCTION public.catalog_photo_writable(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_photo_writable(TEXT, TEXT) TO authenticated;

-- ── 6. Tell the team, server-side ──────────────────────────────
-- send-push refuses a plain customer-role caller, and a vendor IS one — so a
-- vendor cannot fire this from the app, and should not be able to. Same
-- pg_net route the kitchen tick uses, reading the service-role key from Vault
-- with an app_config fallback (D5: the two have drifted before).
--
-- Fire-and-forget by design: a push that fails must never roll back a
-- submission the vendor was told we received.

CREATE OR REPLACE FUNCTION public.notify_admins_listing_submitted(
  p_vendor_name TEXT,
  p_count       INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.notify_admins_listing_submitted(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;

-- Columns are title_template / body_template, and `variables` is NOT NULL —
-- it drives the {{...}} chips in Notification Manager, so a template seeded
-- without it would render an uneditable message in that screen.
INSERT INTO public.notification_templates
  (event_key, title_template, body_template, is_enabled, trigger_source,
   description, variables)
VALUES (
  'admin.vendor_listing_submitted',
  'Vendor listing to review',
  '{{vendor}} sent {{count}} item(s) for approval.',
  TRUE,
  'vendor_listing',
  'Sent to admins when a vendor submits new listings or a change to a live one.',
  ARRAY['vendor', 'count']
)
ON CONFLICT (event_key) DO NOTHING;

-- ── 7. The vendor's side ───────────────────────────────────────

-- The caller's vendor row, if they are an approved vendor. Suspended and
-- pending vendors cannot list.
CREATE OR REPLACE FUNCTION public.my_approved_vendor()
RETURNS public.vendors
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.vendors
  WHERE owner_user_id = auth.uid() AND status = 'approved'
  LIMIT 1;
$$;
REVOKE ALL   ON FUNCTION public.my_approved_vendor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_approved_vendor() TO authenticated;

-- Create an empty draft the vendor can then photograph. Returns the new id,
-- which is what the photo key needs. vendor_id, branch_id and listing_status
-- come from the server, never from the client.
CREATE OR REPLACE FUNCTION public.vendor_create_draft_listing(
  p_name        TEXT,
  p_price       NUMERIC,
  p_unit        TEXT,
  p_cycle_id    INTEGER,
  p_description TEXT DEFAULT NULL,
  p_daily_cap   INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
REVOKE ALL   ON FUNCTION public.vendor_create_draft_listing(TEXT, NUMERIC, TEXT, INTEGER, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_create_draft_listing(TEXT, NUMERIC, TEXT, INTEGER, TEXT, INTEGER) TO authenticated;

-- Send one or more drafts for review, as a batch. A photo is compulsory and
-- checked HERE, not only on the button — the button is a courtesy, this is
-- the rule.
CREATE OR REPLACE FUNCTION public.vendor_submit_listings(p_item_ids INTEGER[])
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
REVOKE ALL   ON FUNCTION public.vendor_submit_listings(INTEGER[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_submit_listings(INTEGER[]) TO authenticated;

-- Propose a change to a listing that is already approved and selling. The
-- live row is not touched. A second proposal replaces the first.
CREATE OR REPLACE FUNCTION public.vendor_propose_listing_change(
  p_item_id       INTEGER,
  p_proposed      JSONB,
  p_photo_pending BOOLEAN DEFAULT FALSE
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
REVOKE ALL   ON FUNCTION public.vendor_propose_listing_change(INTEGER, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_propose_listing_change(INTEGER, JSONB, BOOLEAN) TO authenticated;

-- ── 8. The admin's side ────────────────────────────────────────

-- Approve or reject a NEW listing (listing_status = 'pending').
CREATE OR REPLACE FUNCTION public.admin_review_listing(
  p_item_id INTEGER,
  p_approve BOOLEAN,
  p_reason  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
REVOKE ALL   ON FUNCTION public.admin_review_listing(INTEGER, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_listing(INTEGER, BOOLEAN, TEXT) TO authenticated;

-- Approve or reject a proposed CHANGE to a live listing.
--
-- Returns whether a pending photo now needs promoting from
-- pending/{id}.jpg to {id}.jpg. The caller does the object move BEFORE
-- calling this, and passes p_photo_promoted so image_updated_at is only
-- stamped once the new bytes are actually in place — stamping first would
-- publish a fresh ?v= pointing at the OLD picture, which the CDN would then
-- hold for a month.
CREATE OR REPLACE FUNCTION public.admin_review_listing_change(
  p_change_id       BIGINT,
  p_approve         BOOLEAN,
  p_reason          TEXT DEFAULT NULL,
  p_photo_promoted  BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
REVOKE ALL   ON FUNCTION public.admin_review_listing_change(BIGINT, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_listing_change(BIGINT, BOOLEAN, TEXT, BOOLEAN) TO authenticated;

-- Admin creates one of 1stOne's OWN essentials rows. Needed because §3
-- revoked INSERT from `authenticated` outright — a column-level INSERT grant
-- would have handed the verb to vendors too, since RLS decides which rows
-- rather than whether the verb exists.
CREATE OR REPLACE FUNCTION public.admin_create_essential(
  p_name        TEXT,
  p_price       NUMERIC,
  p_cycle_id    INTEGER,
  p_branch_id   INTEGER,
  p_unit        TEXT DEFAULT 'unit',
  p_description TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
REVOKE ALL   ON FUNCTION public.admin_create_essential(TEXT, NUMERIC, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_essential(TEXT, NUMERIC, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Verification ───────────────────────────────────────────────
-- Impersonate; never check an RLS rule as a superuser.
--
-- -- Every existing row still sells
-- SELECT listing_status, count(*) FROM essentials_catalog GROUP BY 1;
--
-- -- A vendor cannot write the platform's columns even on their own row
-- SET LOCAL ROLE authenticated;
-- SELECT set_config('request.jwt.claims','{"sub":"<vendor-owner>"}', TRUE);
-- UPDATE essentials_catalog SET vendor_cost = 1 WHERE id = <their item>;
--   -- expect: ERROR permission denied for column vendor_cost
-- UPDATE essentials_catalog SET listing_status = 'approved' WHERE id = <theirs>;
--   -- expect: ERROR permission denied for column listing_status
-- UPDATE essentials_catalog SET is_active = FALSE WHERE id = <theirs>;
--   -- expect: SUCCESS — availability is deliberately instant
--
-- -- A customer cannot see a pending listing
-- SELECT set_config('request.jwt.claims','{"sub":"<customer>"}', TRUE);
-- SELECT count(*) FROM essentials_catalog WHERE listing_status <> 'approved';
--   -- expect: 0

-- ── Rollback ───────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.admin_create_essential(TEXT, NUMERIC, INTEGER, INTEGER, TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.admin_review_listing_change(BIGINT, BOOLEAN, TEXT, BOOLEAN);
-- DROP FUNCTION IF EXISTS public.admin_review_listing(INTEGER, BOOLEAN, TEXT);
-- DROP FUNCTION IF EXISTS public.vendor_propose_listing_change(INTEGER, JSONB, BOOLEAN);
-- DROP FUNCTION IF EXISTS public.vendor_submit_listings(INTEGER[]);
-- DROP FUNCTION IF EXISTS public.vendor_create_draft_listing(TEXT, NUMERIC, TEXT, INTEGER, TEXT, INTEGER);
-- DROP FUNCTION IF EXISTS public.my_approved_vendor();
-- DROP FUNCTION IF EXISTS public.notify_admins_listing_submitted(TEXT, INTEGER);
-- DELETE FROM public.notification_templates WHERE event_key = 'admin.vendor_listing_submitted';
-- GRANT INSERT, UPDATE ON public.essentials_catalog TO authenticated;
-- DROP TABLE IF EXISTS public.vendor_listing_changes;
-- ALTER TABLE public.essentials_catalog
--   DROP CONSTRAINT IF EXISTS essentials_listing_status_allowed,
--   DROP COLUMN IF EXISTS listing_status,
--   DROP COLUMN IF EXISTS submitted_at,
--   DROP COLUMN IF EXISTS reviewed_at,
--   DROP COLUMN IF EXISTS reviewed_by,
--   DROP COLUMN IF EXISTS rejection_reason;
-- -- then re-apply vendors_fixes_03_visibility.sql and catalog_photo_policies.sql
