-- ─────────────────────────────────────────────────────────────
-- 1stOne F1 — MF-09: customer_addresses.branch_id auto-derivation
--
-- Today customer_addresses.branch_id is NULL across production —
-- the column was added by add_branch_id_columns_mf03.sql but no
-- code path populates it. Without it, orders.branch_id (derived
-- from the chosen address at place-order time) stays NULL too,
-- and customer-side branch-filtered catalog reads cannot resolve
-- which branch to filter by.
--
-- This trigger fills branch_id on INSERT and on UPDATE OF hub_id /
-- zone_id, picking hub_id's branch first then falling back to
-- zone_id's branch. Idempotent — only writes when branch_id was
-- left NULL by the caller (clients can still set it explicitly).
--
-- Backfill of existing rows is a one-shot UPDATE run from the
-- Dashboard (captured in the MF-09 commit body, not in tracked
-- migrations because it's data, not schema).
--
-- Run via Supabase Dashboard → SQL Editor. Idempotent.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION derive_address_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := COALESCE(
      (SELECT branch_id FROM delivery_hubs  WHERE id = NEW.hub_id),
      (SELECT branch_id FROM delivery_zones WHERE id = NEW.zone_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_address_branch_id ON customer_addresses;
CREATE TRIGGER trg_address_branch_id
  BEFORE INSERT OR UPDATE OF hub_id, zone_id ON customer_addresses
  FOR EACH ROW
  EXECUTE FUNCTION derive_address_branch_id();
