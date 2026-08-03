-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — The unit belongs to the Menu Item (2026-08-03)
--
-- A unit was a property of each RECIPE LINE, so the same ingredient could be
-- measured differently in different menus. It found one already: Sagu is
-- "ml" in Poori and Mangalore Buns, and "g" in Lunch Box. Nothing was wrong
-- with the data — the model simply allowed it.
--
-- Sambar is measured in ml. Always. That belongs to Sambar, not to each menu
-- that happens to use it. So `unit` moves onto the row, the recipe keeps
-- carrying it in text (get_kitchen_aggregate parses it there and groups prep
-- by (name, unit)), and the menu editor stops asking — it shows the item's
-- unit and only takes a number.
--
-- Deploy: supabase db query --linked --file supabase/sql/menu_item_units.sql
-- Idempotent. Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. The column ──────────────────────────────────────────────
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'no';

COMMENT ON COLUMN public.menu_items.unit IS
  'How this item is measured — one of no, g, ml, cup, plate, bowl. Meaningful '
  'on building blocks; a customer-facing dish keeps the default and ignores it.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_unit_allowed') THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_unit_allowed
      CHECK (unit IN ('no', 'g', 'ml', 'cup', 'plate', 'bowl'));
  END IF;
END $$;

-- ── 2. Take each block's unit from how it is already used ──────
-- Majority wins, so Sagu becomes 'ml' (used twice) rather than 'g' (once).
-- A block named by no recipe keeps the 'no' default.
WITH used AS (
  SELECT btrim(split_part(c, ':', 1)) AS nm,
         NULLIF(btrim(regexp_replace(btrim(split_part(c, ':', 2)), '^[0-9.]+', '')), '') AS unit,
         count(*) AS n
  FROM public.menu_items, LATERAL regexp_split_to_table(COALESCE(ingredients, ''), ';') c
  WHERE is_customer_visible AND btrim(c) <> ''
  GROUP BY 1, 2
), winner AS (
  SELECT DISTINCT ON (nm) nm, unit
  FROM used WHERE unit IS NOT NULL
  ORDER BY nm, n DESC, unit
)
UPDATE public.menu_items b
   SET unit = w.unit
  FROM winner w
 WHERE NOT b.is_customer_visible
   AND lower(b.name) = lower(w.nm)
   AND w.unit IN ('no', 'g', 'ml', 'cup', 'plate', 'bowl');

-- ── 3. Make every recipe agree with its item ───────────────────
-- This is what actually resolves Sagu: Lunch Box's "Sagu:200 g" becomes
-- "Sagu:200 ml". The kitchen groups prep by (name, unit), so leaving the two
-- forms in place would keep showing Sagu as two separate prep lines.
WITH rebuilt AS (
  SELECT mi.id,
         string_agg(
           btrim(split_part(ch.chunk, ':', 1)) || ':'
             || btrim(regexp_replace(btrim(split_part(ch.chunk, ':', 2)), '\s*[A-Za-z]+\s*$', ''))
             || ' ' || COALESCE(b.unit, 'no'),
           ';' ORDER BY ch.ord) AS ing
  FROM public.menu_items mi
  CROSS JOIN LATERAL regexp_split_to_table(mi.ingredients, ';') WITH ORDINALITY AS ch(chunk, ord)
  LEFT JOIN public.menu_items b
    ON NOT b.is_customer_visible
   AND lower(b.name) = lower(btrim(split_part(ch.chunk, ':', 1)))
  WHERE mi.is_customer_visible
    AND mi.ingredients IS NOT NULL AND btrim(ch.chunk) <> ''
  GROUP BY mi.id)
UPDATE public.menu_items m
   SET ingredients = r.ing
  FROM rebuilt r
 WHERE m.id = r.id AND m.ingredients IS DISTINCT FROM r.ing;

-- ── 4. Creating a block now takes its unit ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_menu_block(
  p_name TEXT, p_price NUMERIC, p_branch_id INTEGER, p_unit TEXT DEFAULT 'no'
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only.';
  END IF;
  IF NOT public.has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'That branch is not yours.';
  END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Enter a name.';
  END IF;
  IF position(':' IN p_name) > 0 OR position(';' IN p_name) > 0 THEN
    RAISE EXCEPTION 'A name cannot contain ":" or ";" — they separate the parts of a recipe.';
  END IF;

  INSERT INTO public.menu_items
    (name, price, unit, cycle_id, ingredients, is_active, is_customer_visible, branch_id, sort_order)
  VALUES
    (btrim(p_name), COALESCE(p_price, 0),
     CASE WHEN p_unit IN ('no','g','ml','cup','plate','bowl') THEN p_unit ELSE 'no' END,
     NULL, NULL, TRUE, FALSE, p_branch_id, 0)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;
REVOKE ALL   ON FUNCTION public.admin_create_menu_block(TEXT, NUMERIC, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_menu_block(TEXT, NUMERIC, INTEGER, TEXT) TO authenticated;

-- ── 5. Changing a block's unit rewrites the recipes too ────────
-- Same reason a rename does: the unit lives in the recipe text as well as on
-- the row, and the kitchen reads the text.
CREATE OR REPLACE FUNCTION public.admin_set_menu_block_unit(p_id INTEGER, p_unit TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name TEXT; v_recipes INTEGER := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only.';
  END IF;
  IF p_unit NOT IN ('no','g','ml','cup','plate','bowl') THEN
    RAISE EXCEPTION 'Unknown unit "%".', p_unit;
  END IF;

  SELECT name INTO v_name FROM public.menu_items
   WHERE id = p_id AND NOT is_customer_visible;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Menu item not found.';
  END IF;

  UPDATE public.menu_items SET unit = p_unit WHERE id = p_id;

  WITH rebuilt AS (
    SELECT mi.id,
           string_agg(
             CASE WHEN lower(btrim(split_part(ch.chunk, ':', 1))) = lower(v_name)
                  THEN btrim(split_part(ch.chunk, ':', 1)) || ':'
                       || btrim(regexp_replace(btrim(split_part(ch.chunk, ':', 2)), '\s*[A-Za-z]+\s*$', ''))
                       || ' ' || p_unit
                  ELSE btrim(ch.chunk) END,
             ';' ORDER BY ch.ord) AS ing
    FROM public.menu_items mi
    CROSS JOIN LATERAL regexp_split_to_table(mi.ingredients, ';') WITH ORDINALITY AS ch(chunk, ord)
    WHERE mi.is_customer_visible
      AND mi.ingredients IS NOT NULL AND btrim(ch.chunk) <> ''
    GROUP BY mi.id)
  UPDATE public.menu_items m SET ingredients = r.ing
    FROM rebuilt r WHERE m.id = r.id AND m.ingredients IS DISTINCT FROM r.ing;

  GET DIAGNOSTICS v_recipes = ROW_COUNT;
  RETURN v_recipes;
END $$;
REVOKE ALL   ON FUNCTION public.admin_set_menu_block_unit(INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_menu_block_unit(INTEGER, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Rollback ───────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.admin_set_menu_block_unit(INTEGER, TEXT);
-- ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_unit_allowed;
-- ALTER TABLE public.menu_items DROP COLUMN IF EXISTS unit;
