-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Vendor network, part 3: the admin write surface
--
-- vendors_schema.sql revoked UPDATE on `vendors` from `authenticated` and
-- granted back only the seven business-detail columns, so a vendor cannot
-- approve themselves or move their own commission. Admins are also
-- `authenticated`, so the same grant stops them — which is why every
-- privileged write lives here instead, as a SECURITY DEFINER RPC behind an
-- is_admin() gate.
--
-- That is the pattern this codebase already uses for exactly this reason:
-- profiles.role is not grantable and moves through elevate_to_staff;
-- wallet balances move through increment_wallet_balance; order money moves
-- through admin_cancel_order_atomic.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- Requires: vendors_schema.sql applied first.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Onboard: elevate a REGISTERED user to an invited vendor ──
-- The person must already exist as a user (self-registered, or added
-- through the back-office customer screen). This does not create logins —
-- it elevates one, the same way elevate_to_staff does for employees.
CREATE OR REPLACE FUNCTION public.admin_onboard_vendor(
  p_user_id            UUID,
  p_business_name      TEXT,
  p_contact_phone      TEXT DEFAULT NULL,
  p_selling_model      TEXT DEFAULT 'own_brand',
  p_supply_mode        TEXT DEFAULT 'they_drop',
  p_commission_percent NUMERIC DEFAULT 0,
  p_branch_id          INTEGER DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor_id BIGINT;
  v_branch_id INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may onboard vendors';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'That person is not a registered user yet. Register them first.';
  END IF;

  IF EXISTS (SELECT 1 FROM vendors WHERE owner_user_id = p_user_id) THEN
    RAISE EXCEPTION 'This person is already a vendor.';
  END IF;

  -- Default the vendor to the person's own branch. Where they may SELL is
  -- a separate thing entirely (vendor_zones) — a Siddapur producer will
  -- eventually sell into Bangalore.
  SELECT COALESCE(p_branch_id, branch_id, 1) INTO v_branch_id
  FROM profiles WHERE id = p_user_id;

  INSERT INTO vendors (
    owner_user_id, branch_id, business_name, contact_phone,
    selling_model, supply_mode, commission_percent,
    status, invited_by
  ) VALUES (
    p_user_id, v_branch_id, NULLIF(btrim(p_business_name), ''), p_contact_phone,
    p_selling_model, p_supply_mode, COALESCE(p_commission_percent, 0),
    'invited', auth.uid()
  )
  RETURNING id INTO v_vendor_id;

  -- profiles.vendor_id is not grantable to authenticated, so it can only be
  -- set from in here. Kept in step with vendors.owner_user_id so a future
  -- JWT claim (like assigned_hub_id) can read it without a backfill.
  UPDATE profiles SET vendor_id = v_vendor_id WHERE id = p_user_id;

  RETURN v_vendor_id;
END;
$$;

-- ── 2. Verify / approve / suspend ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_vendor_status(
  p_vendor_id BIGINT,
  p_status    TEXT,
  p_note      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may change vendor status';
  END IF;
  IF p_status NOT IN ('invited', 'submitted', 'approved', 'suspended', 'rejected') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  SELECT status INTO v_before FROM vendors WHERE id = p_vendor_id FOR UPDATE;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'vendor % not found', p_vendor_id;
  END IF;

  UPDATE vendors
  SET status      = p_status,
      admin_note  = COALESCE(p_note, admin_note),
      approved_by = CASE WHEN p_status = 'approved' THEN auth.uid() ELSE approved_by END,
      approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE approved_at END,
      updated_at  = now()
  WHERE id = p_vendor_id;

  -- Suspension takes their catalogue down immediately. Orders already
  -- placed are honoured and any balance stays claimable — only new selling
  -- stops. Re-approving does NOT auto-relist; the vendor turns items back
  -- on themselves, so nothing they meant to retire quietly reappears.
  IF p_status IN ('suspended', 'rejected') THEN
    UPDATE essentials_catalog
    SET is_active = FALSE
    WHERE vendor_id = p_vendor_id AND is_active = TRUE;
  END IF;

  RETURN jsonb_build_object(
    'vendor_id', p_vendor_id, 'from', v_before, 'to', p_status
  );
END;
$$;

-- ── 3. Terms — the negotiated part of the relationship ─────────
-- Every one of these is a term you agree with a vendor, which is why they
-- are data on the record rather than branches in code.
CREATE OR REPLACE FUNCTION public.admin_set_vendor_terms(
  p_vendor_id          BIGINT,
  p_commission_percent NUMERIC DEFAULT NULL,
  p_selling_model      TEXT    DEFAULT NULL,
  p_supply_mode        TEXT    DEFAULT NULL,
  p_return_policy      TEXT    DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may set vendor terms';
  END IF;
  IF p_commission_percent IS NOT NULL
     AND (p_commission_percent < 0 OR p_commission_percent > 100) THEN
    RAISE EXCEPTION 'commission must be between 0 and 100';
  END IF;

  UPDATE vendors
  SET commission_percent = COALESCE(p_commission_percent, commission_percent),
      selling_model      = COALESCE(p_selling_model, selling_model),
      supply_mode        = COALESCE(p_supply_mode, supply_mode),
      return_policy      = COALESCE(p_return_policy, return_policy),
      updated_at         = now()
  WHERE id = p_vendor_id;
END;
$$;

-- ── 4. Grants ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.admin_onboard_vendor(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_vendor_status(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_vendor_terms(BIGINT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_onboard_vendor(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_vendor_status(BIGINT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_vendor_terms(BIGINT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
