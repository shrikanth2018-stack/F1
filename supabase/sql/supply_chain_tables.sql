-- ─────────────────────────────────────────────────────────────
-- 1stOne F1 — Supply-chain tables (Stock Manager / Staff order requests)
--
-- MF-08 (2026-05-11): captured from prod into tracked SQL. These tables
-- live in production but their CREATE TABLE definitions had never made it
-- into supabase/sql/ — a fresh rebuild from this directory would have
-- failed at the RLS policy + trigger files that referenced them. Same
-- class of drift BF-37 just fixed for custom_access_token_hook.
--
-- Lineage: introduced piecemeal during the BF-17 Stock Manager work
-- (2026-05-04, "Solution D unified view") and the BF-14/BF-15 RLS rounds.
-- Definitions below are dump-style derivatives of the live prod state via
-- information_schema + pg_get_constraintdef.
--
-- Dependencies: requires public.profiles and public.branches to exist.
-- Companion files (already tracked, run AFTER this one):
--   - add_supply_catalog_staff_read_policy.sql  (BF-14)
--   - add_staff_order_requests_policies.sql     (BF-15)
--   - staff_order_requests_mirror_trigger.sql   (BF-17, adds the INSERT
--     trigger + add_or_merge_supply_order_item RPC)
--
-- Run via supabase db query --file --linked. Idempotent.
-- ─────────────────────────────────────────────────────────────


-- ── 1. supply_catalog — admin-curated master list of supply items ─────
CREATE TABLE IF NOT EXISTS public.supply_catalog (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (name, category)
);


-- ── 2. staff_order_requests — submissions from Staff Dashboard ────────
--    Kitchen/Packing staff use the "Vegetables / Grocery / Stationery"
--    forms to request supplies; admin approves in Stock Manager.
CREATE TABLE IF NOT EXISTS public.staff_order_requests (
  id            SERIAL PRIMARY KEY,
  request_type  TEXT NOT NULL CHECK (request_type IN ('Vegetables','Grocery','Stationery')),
  items         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  submitted_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  branch_id     INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 3. supply_batches — printed batches from Stock Manager ────────────
--    When admin prints a category, the snapshot of items is recorded
--    here so historical reprints / audit are possible.
CREATE TABLE IF NOT EXISTS public.supply_batches (
  id              SERIAL PRIMARY KEY,
  printed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  printed_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  items_snapshot  JSONB NOT NULL DEFAULT '[]'::jsonb,
  note            TEXT,
  branch_id       INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 4. supply_order_items — current open + historical line items ──────
--    Rows with batch_id IS NULL are in the current open order; once a
--    batch is printed, the items move (or get copied via snapshot) onto
--    that batch. Mirror trigger (BF-17) keeps this table in sync when
--    staff approvals flow through staff_order_requests.
CREATE TABLE IF NOT EXISTS public.supply_order_items (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  qty         INTEGER NOT NULL DEFAULT 1,
  category    TEXT NOT NULL CHECK (category IN ('Vegetables','Grocery','Stationery')),
  request_id  INTEGER REFERENCES public.staff_order_requests(id) ON DELETE SET NULL,
  batch_id    INTEGER REFERENCES public.supply_batches(id) ON DELETE SET NULL,
  added_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  branch_id   INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
