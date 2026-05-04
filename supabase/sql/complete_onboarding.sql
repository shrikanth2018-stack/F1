-- ─────────────────────────────────────────────────────────────
-- complete_onboarding_atomic — first-customer onboarding RPC
--
-- Atomically writes the profile name + the customer's first
-- delivery address in a single PostgreSQL transaction. If
-- either insert fails, both roll back together.
--
-- Used only by the new-user onboarding flow (after OTP verify).
-- Existing-customer additional-address flow continues to use
-- the plain useAddAddress hook (no RPC).
--
-- Run in Supabase SQL editor. Idempotent (CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION complete_onboarding_atomic(
  p_user_id        UUID,
  p_phone_number   TEXT,
  p_full_name      TEXT,
  p_label          TEXT,
  p_address_line   TEXT,
  p_landmark       TEXT,
  p_city           TEXT,
  p_pincode        TEXT,
  p_latitude       NUMERIC,
  p_longitude      NUMERIC,
  p_zone_id        INTEGER,
  p_hub_id         INTEGER,
  p_is_serviceable BOOLEAN
)
RETURNS BIGINT  -- returns the new address id
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_address_id BIGINT;
BEGIN
  -- Defense in depth: only allow the authenticated user to onboard themselves.
  -- The function is SECURITY DEFINER, so without this guard any authenticated
  -- caller could pass an arbitrary UUID and write to another user's rows.
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'unauthorized: p_user_id does not match auth.uid()';
  END IF;

  -- Upsert the profile. A row may already exist from a prior
  -- partial onboarding attempt (UPDATE path); otherwise INSERT
  -- creates it. Both paths are atomic with the address INSERT below.
  INSERT INTO profiles (id, phone_number, full_name)
  VALUES (p_user_id, p_phone_number, p_full_name)
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name;

  -- Insert the first delivery address. is_default = TRUE
  -- since this is the user's only address.
  INSERT INTO customer_addresses (
    user_id, label, full_name, address_line, landmark, city, pincode,
    latitude, longitude, zone_id, hub_id, is_serviceable, is_default
  ) VALUES (
    p_user_id, p_label, p_full_name, p_address_line, p_landmark, p_city, p_pincode,
    p_latitude, p_longitude, p_zone_id, p_hub_id, p_is_serviceable, TRUE
  )
  RETURNING id INTO v_address_id;

  RETURN v_address_id;
END;
$$;

GRANT EXECUTE ON FUNCTION complete_onboarding_atomic(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, INTEGER, INTEGER, BOOLEAN
) TO authenticated;
