-- ============================================================
-- 1stOne F1 — atomic set-default-address RPC (audit D35)
-- Applied to live DB 2026-05-19.
--
-- Replaces the client's two non-atomic UPDATEs (clear-all-defaults then
-- set-one). If the second failed mid-flight the customer was left with
-- zero default addresses. This RPC runs both in a single transaction.
--
-- SECURITY DEFINER + auth.uid() ownership check — a caller can only
-- re-default their own address.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_default_address(p_address_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- The target address must belong to the caller and be active.
  IF NOT EXISTS (
    SELECT 1 FROM customer_addresses
    WHERE id = p_address_id AND user_id = v_user AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'address % not found for this user', p_address_id;
  END IF;

  -- Clear the existing default, then set the new one — one transaction.
  UPDATE customer_addresses
  SET is_default = FALSE
  WHERE user_id = v_user AND is_default = TRUE;

  UPDATE customer_addresses
  SET is_default = TRUE
  WHERE id = p_address_id AND user_id = v_user;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_address(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_address(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
