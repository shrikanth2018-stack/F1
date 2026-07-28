-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Vendor network, part 1: schema + RLS
--
-- Third-party vendors list their own items in the ESSENTIALS section,
-- scoped to the zones/hubs they sell into. Food is never involved — the
-- kitchen aggregation is untouched by this entire feature.
--
-- Onboarding is two-sided, mirroring how a hub operator already works
-- (profile-menu entry → their own dashboard):
--
--   invited    admin elevates a REGISTERED user with basic details; a
--              "Complete vendor registration" entry appears in that
--              person's profile menu
--   submitted  vendor fills business name / GST / FSSAI, accepts terms
--   approved   admin verifies; the menu entry becomes their store and
--              their items may go live
--   suspended  items go inactive; existing orders honoured; balance stays
--              claimable
--   rejected   terminal
--
-- Vendor items live in `essentials_catalog` with a vendor_id rather than a
-- table of their own. That is deliberate: they then inherit cycle tagging,
-- the cart, buildAuthoritativeOrder, GST carve-out and the kitchen
-- exclusion, so THE ORDER PATH NEEDS NO CHANGE AT ALL.
--
-- This file is additive and behaviour-neutral: new tables, one nullable
-- column, and policies that only ever GRANT access to a role that does not
-- exist yet. Nothing existing changes.
--
-- Money (credit-on-delivery) is deliberately NOT here — it lives in
-- vendors_earnings_trigger.sql so it can be reviewed on its own.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- Rollback: DROP TABLE vendor_zones, vendor_earnings, vendors CASCADE;
--           ALTER TABLE essentials_catalog DROP COLUMN vendor_id;
--           ALTER TABLE profiles DROP COLUMN vendor_id;
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Vendors ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendors (
  id                 BIGSERIAL PRIMARY KEY,
  -- The vendor must already be a registered user (self-signed-up, or added
  -- by an admin through the back-office customer screen).
  owner_user_id      UUID NOT NULL REFERENCES auth.users(id),
  branch_id          INTEGER REFERENCES public.branches(id),

  business_name      TEXT,
  contact_phone      TEXT,
  gst_number         TEXT,
  fssai_number       TEXT,

  -- Own brand  = vendor is the seller of record; their GSTIN on the
  --              invoice; you take commission; TCS applies.
  -- House brand= you are the seller of record; your GSTIN, brand and FSSAI;
  --              you BUY at an agreed rate and your margin is the spread.
  selling_model      TEXT NOT NULL DEFAULT 'own_brand'
                     CHECK (selling_model IN ('own_brand', 'house_brand')),

  -- How the goods reach the delivery point. PROCUREMENT ONLY — nothing
  -- downstream of the delivery point may depend on it. The last mile is
  -- always 1stOne's.
  supply_mode        TEXT NOT NULL DEFAULT 'they_drop'
                     CHECK (supply_mode IN ('at_hub', 'we_collect', 'they_drop')),

  commission_percent NUMERIC NOT NULL DEFAULT 0
                     CHECK (commission_percent >= 0 AND commission_percent <= 100),

  status             TEXT NOT NULL DEFAULT 'invited'
                     CHECK (status IN ('invited', 'submitted', 'approved', 'suspended', 'rejected')),

  return_policy      TEXT,
  terms_accepted_at  TIMESTAMPTZ,
  invited_by         UUID REFERENCES auth.users(id),
  submitted_at       TIMESTAMPTZ,
  approved_by        UUID REFERENCES auth.users(id),
  approved_at        TIMESTAMPTZ,
  admin_note         TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One vendor record per person. Lift this later if a business ever needs
-- several logins; nothing here assumes it stays.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vendors_owner_user
  ON public.vendors (owner_user_id);

-- A SECOND foreign key on the same column, deliberately. owner_user_id
-- already references auth.users, but PostgREST can only embed `profiles`
-- through a constraint that actually targets `profiles` — without this,
-- select('*, profiles!...') fails with "could not find a relationship".
-- staff_attendance carries the same pair for the same reason. Safe because
-- profiles.id IS auth.users.id, and the on_auth_user_created trigger
-- guarantees a profile row exists before anyone can be made a vendor.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendors_owner_profile_fkey'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_owner_profile_fkey
      FOREIGN KEY (owner_user_id) REFERENCES public.profiles(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vendors_status
  ON public.vendors (status) WHERE status <> 'approved';

COMMENT ON COLUMN public.vendors.supply_mode IS
  'How goods reach the delivery point: at_hub (already there), we_collect, they_drop. Procurement attribute only — the last mile is always 1stOne''s.';
COMMENT ON COLUMN public.vendors.selling_model IS
  'own_brand = marketplace, vendor is seller of record, commission. house_brand = 1stOne is seller of record under its own GSTIN/FSSAI and BUYS at an agreed rate.';

-- ── 2. Where a vendor may sell ─────────────────────────────────
-- Deliberately independent of vendors.branch_id: a Siddapur producer will
-- eventually sell into Bangalore zones.
CREATE TABLE IF NOT EXISTS public.vendor_zones (
  id         BIGSERIAL PRIMARY KEY,
  vendor_id  BIGINT NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  zone_id    INTEGER REFERENCES public.delivery_zones(id) ON DELETE CASCADE,
  hub_id     INTEGER REFERENCES public.delivery_hubs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one of the two, never both, never neither.
  CONSTRAINT vendor_zones_one_target CHECK ((zone_id IS NULL) <> (hub_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_zones_zone
  ON public.vendor_zones (vendor_id, zone_id) WHERE zone_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_zones_hub
  ON public.vendor_zones (vendor_id, hub_id) WHERE hub_id IS NOT NULL;

-- ── 3. Catalogue + profile links ───────────────────────────────
-- NULL vendor_id = 1stOne's own item, which is every existing row.
ALTER TABLE public.essentials_catalog
  ADD COLUMN IF NOT EXISTS vendor_id BIGINT REFERENCES public.vendors(id);

CREATE INDEX IF NOT EXISTS idx_essentials_vendor
  ON public.essentials_catalog (vendor_id) WHERE vendor_id IS NOT NULL;

-- Daily cap: sells out and hides for the rest of the day. NULL = no cap,
-- which is how every 1stOne-owned item behaves today.
ALTER TABLE public.essentials_catalog
  ADD COLUMN IF NOT EXISTS daily_cap INTEGER
  CHECK (daily_cap IS NULL OR daily_cap > 0);

-- Routing only. Kept OUT of the JWT on purpose: custom_access_token_hook
-- runs for every login of every user and has drifted before (BF-37). A
-- cached read of `vendors` gives the app the same answer with none of that
-- blast radius. Promote to a claim later if the extra query ever matters.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vendor_id BIGINT REFERENCES public.vendors(id);

-- ── 4. Earnings ledger ─────────────────────────────────────────
-- The wallet holds the BALANCE (decision: one wallet per person, even when
-- someone is customer + hub operator + vendor). This table holds the
-- breakdown an accountant needs, which a single `amount` column cannot.
CREATE TABLE IF NOT EXISTS public.vendor_earnings (
  id                    BIGSERIAL PRIMARY KEY,
  vendor_id             BIGINT NOT NULL REFERENCES public.vendors(id),
  order_id              BIGINT NOT NULL REFERENCES public.orders(id),
  order_item_id         BIGINT NOT NULL REFERENCES public.order_items(id),
  gross_amount          NUMERIC NOT NULL,
  commission_percent    NUMERIC NOT NULL,
  commission_amount     NUMERIC NOT NULL,
  net_amount            NUMERIC NOT NULL,
  selling_model         TEXT NOT NULL,
  -- The wallet row this credit produced, so the ledger and the balance can
  -- always be reconciled against each other.
  wallet_transaction_id BIGINT REFERENCES public.wallet_transactions(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The idempotency guard. An order can reach Delivered more than once (a
-- staff correction, an offline replay); this makes a second credit for the
-- same line impossible at the database level rather than by convention.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_earnings_order_item
  ON public.vendor_earnings (order_item_id);

CREATE INDEX IF NOT EXISTS idx_vendor_earnings_vendor
  ON public.vendor_earnings (vendor_id, created_at DESC);

-- ── 5. RLS ─────────────────────────────────────────────────────
ALTER TABLE public.vendors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_zones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_earnings  ENABLE ROW LEVEL SECURITY;

-- Vendors: the owner reads and completes their own registration; admins
-- manage within their branch. The owner may NOT set status, commission or
-- selling model — those go through the admin path only (enforced by the
-- column grants below, not by trust).
DROP POLICY IF EXISTS vendors_owner_read ON public.vendors;
CREATE POLICY vendors_owner_read ON public.vendors
  FOR SELECT USING (
    owner_user_id = auth.uid()
    OR (public.is_staff_or_admin() AND public.has_branch_access(branch_id))
  );

DROP POLICY IF EXISTS vendors_owner_update ON public.vendors;
CREATE POLICY vendors_owner_update ON public.vendors
  FOR UPDATE
  USING      (owner_user_id = auth.uid() AND status IN ('invited', 'submitted'))
  WITH CHECK (owner_user_id = auth.uid() AND status IN ('invited', 'submitted'));

DROP POLICY IF EXISTS vendors_admin_all ON public.vendors;
CREATE POLICY vendors_admin_all ON public.vendors
  FOR ALL USING      (public.is_admin() AND public.has_branch_access(branch_id))
          WITH CHECK (public.is_admin() AND public.has_branch_access(branch_id));

-- Column grants: a vendor may fill in their own business details and
-- nothing else. status, commission_percent, selling_model, supply_mode and
-- the approval columns are admin-only, and this is what enforces it.
REVOKE UPDATE ON public.vendors FROM authenticated;
GRANT  UPDATE (business_name, contact_phone, gst_number, fssai_number,
               return_policy, terms_accepted_at, submitted_at)
  ON public.vendors TO authenticated;

-- Zones: readable by the owner and by staff/admin; written by admins only.
-- A vendor asks for a zone, an admin grants it.
DROP POLICY IF EXISTS vendor_zones_read ON public.vendor_zones;
CREATE POLICY vendor_zones_read ON public.vendor_zones
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.vendors v
            WHERE v.id = vendor_id AND v.owner_user_id = auth.uid())
    OR public.is_staff_or_admin()
  );

DROP POLICY IF EXISTS vendor_zones_admin_write ON public.vendor_zones;
CREATE POLICY vendor_zones_admin_write ON public.vendor_zones
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Earnings: the vendor sees their own; admins see their branch's. Nobody
-- writes from the app — rows are created by the credit-on-delivery trigger
-- running as the definer.
DROP POLICY IF EXISTS vendor_earnings_read ON public.vendor_earnings;
CREATE POLICY vendor_earnings_read ON public.vendor_earnings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.vendors v
            WHERE v.id = vendor_id AND v.owner_user_id = auth.uid())
    OR public.is_admin()
  );

-- ── 6. Vendors write their OWN catalogue rows ──────────────────
-- essentials_catalog already has public read + branch-scoped admin write.
-- This adds exactly one path: an APPROVED vendor may manage rows that carry
-- their own vendor_id, and no others.
DROP POLICY IF EXISTS essentials_vendor_write ON public.essentials_catalog;
CREATE POLICY essentials_vendor_write ON public.essentials_catalog
  FOR ALL
  USING (
    vendor_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.vendors v
                WHERE v.id = essentials_catalog.vendor_id
                  AND v.owner_user_id = auth.uid()
                  AND v.status = 'approved')
  )
  WITH CHECK (
    vendor_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.vendors v
                WHERE v.id = essentials_catalog.vendor_id
                  AND v.owner_user_id = auth.uid()
                  AND v.status = 'approved')
  );

NOTIFY pgrst, 'reload schema';
