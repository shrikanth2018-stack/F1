-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — A Menu Item's price is for a stated quantity (2026-08-03)
--
-- "Sambar ₹20" answers nothing on its own — ₹20 for how much? The unit said
-- how it is measured but never how much the price buys, so the one place that
-- price is used (a bulk order buying the item on its own) was quoting a figure
-- with no quantity attached to it.
--
-- So a block now reads "₹20 for 150 ml", and a bulk line of ×2 is 300 ml at
-- ₹40. The order path needs NO change: it already multiplies price by the line
-- quantity, and that quantity is now unambiguously "how many of these".
--
-- NOT A CASCADE, unlike the unit and the name. A recipe line carries its own
-- quantity ("Sambar:150 ml"), which is what that dish contains — a different
-- question from what ₹20 buys. Nothing inside `ingredients` changes here, so
-- get_kitchen_aggregate is untouched and no prep line can split.
--
-- Deploy: supabase db query --linked --file supabase/sql/menu_item_base_quantity.sql
-- Idempotent. Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. The column ──────────────────────────────────────────────
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS base_quantity NUMERIC NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.menu_items.base_quantity IS
  'How much of `unit` the price buys — Sambar ₹20 for 150 ml. Meaningful on a '
  'building block, where the price is what a bulk order pays for one of these; '
  'a customer-facing dish keeps the default 1 and ignores it. Unrelated to the '
  'quantity inside a recipe line, which is what THAT dish contains.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_base_quantity_positive') THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_base_quantity_positive
      CHECK (base_quantity > 0);
  END IF;
END $$;

-- ── 2. Seed each block from how it is already portioned ────────
-- Majority wins, the same rule menu_item_units.sql used for the unit, so
-- Sambar arrives at the 150 ml that nine recipes already ask for rather than
-- at a meaningless 1. A block named by no recipe keeps the default.
--
-- Every block is priced ₹0 today, so this is cosmetic until someone prices
-- one — which is exactly when a wrong quantity would start costing money, and
-- exactly when the editor now puts the two fields side by side.
WITH used AS (
  SELECT btrim(split_part(c, ':', 1)) AS nm,
         NULLIF(btrim(regexp_replace(btrim(split_part(c, ':', 2)), '[^0-9.].*$', '')), '')::NUMERIC AS qty,
         count(*) AS n
  FROM public.menu_items, LATERAL regexp_split_to_table(COALESCE(ingredients, ''), ';') c
  WHERE is_customer_visible AND btrim(c) <> ''
  GROUP BY 1, 2
), winner AS (
  SELECT DISTINCT ON (nm) nm, qty
  FROM used WHERE qty IS NOT NULL AND qty > 0
  ORDER BY nm, n DESC, qty
)
UPDATE public.menu_items b
   SET base_quantity = w.qty
  FROM winner w
 WHERE NOT b.is_customer_visible
   AND lower(b.name) = lower(w.nm)
   AND b.base_quantity = 1;

-- ── 3. Creating a block takes its quantity ─────────────────────
-- DROP first, deliberately: CREATE OR REPLACE with a longer argument list
-- makes an OVERLOAD, not a replacement, and PostgREST would then have two
-- candidates for the same named-argument call. The old app build sends four
-- named arguments and still resolves here, because the new one has a default.
DROP FUNCTION IF EXISTS public.admin_create_menu_block(TEXT, NUMERIC, INTEGER, TEXT);

-- And the THREE-argument original, which had been left behind exactly this way:
-- menu_manager_rebuild.sql §8 created it, menu_item_units.sql added the
-- four-argument form without dropping it, and both have been live since. A call
-- naming only (p_name, p_price, p_branch_id) — which is how the CSV importer
-- creates a block — matched both, and an ambiguous call is an error, not a
-- coin toss. Dropping it leaves one candidate for every call shape: three, four
-- or five named arguments all resolve here now.
DROP FUNCTION IF EXISTS public.admin_create_menu_block(TEXT, NUMERIC, INTEGER);

CREATE OR REPLACE FUNCTION public.admin_create_menu_block(
  p_name TEXT, p_price NUMERIC, p_branch_id INTEGER,
  p_unit TEXT DEFAULT 'nos', p_base_qty NUMERIC DEFAULT 1
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id INTEGER;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only.'; END IF;
  IF NOT public.has_branch_access(p_branch_id) THEN RAISE EXCEPTION 'That branch is not yours.'; END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'Enter a name.'; END IF;
  IF position(':' IN p_name) > 0 OR position(';' IN p_name) > 0 THEN
    RAISE EXCEPTION 'A name cannot contain ":" or ";" — they separate the parts of a recipe.';
  END IF;

  INSERT INTO public.menu_items
    (name, price, unit, base_quantity, cycle_id, ingredients,
     is_active, is_customer_visible, branch_id, sort_order)
  VALUES
    (btrim(p_name), COALESCE(p_price, 0),
     CASE WHEN p_unit IN ('nos','gms','ml','cup','plate','bowl') THEN p_unit ELSE 'nos' END,
     CASE WHEN COALESCE(p_base_qty, 1) > 0 THEN p_base_qty ELSE 1 END,
     NULL, NULL, TRUE, FALSE, p_branch_id, 0)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL   ON FUNCTION public.admin_create_menu_block(TEXT, NUMERIC, INTEGER, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_menu_block(TEXT, NUMERIC, INTEGER, TEXT, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Rollback ───────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.admin_create_menu_block(TEXT, NUMERIC, INTEGER, TEXT, NUMERIC);
-- ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_base_quantity_positive;
-- ALTER TABLE public.menu_items DROP COLUMN IF EXISTS base_quantity;
-- Then re-run menu_unit_wording.sql to restore the four-argument create RPC.
