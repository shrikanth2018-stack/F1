-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Unit tokens become the words staff read (2026-08-03)
--
-- 'g' and 'no' become 'gms' and 'nos'.
--
-- The token IS the display. StaffDashboard renders the kitchen board straight
-- from the recipe text the server aggregates — `${quantity}${unit}` — so
-- there is no translation layer, and adding one would mean remembering it on
-- every screen a unit ever reaches. Storing the readable form makes that
-- impossible to get wrong.
--
-- Safe to do because these units are INTERNAL: kitchen prep, the admin editor
-- and bulk ordering. A customer sees the quantity of the MENU they bought,
-- never the quantity of an ingredient inside it — no customer screen renders
-- `ingredients` at all.
--
-- get_kitchen_aggregate groups prep by (name, unit), so the column and the
-- recipe text must move together or one ingredient becomes two prep lines.
--
-- Deploy: supabase db query --linked --file supabase/sql/menu_unit_wording.sql
-- Idempotent. Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_unit_allowed;

UPDATE public.menu_items SET unit = 'gms' WHERE unit = 'g';
UPDATE public.menu_items SET unit = 'nos' WHERE unit = 'no';

ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_unit_allowed
  CHECK (unit IN ('nos', 'gms', 'ml', 'cup', 'plate', 'bowl'));

ALTER TABLE public.menu_items ALTER COLUMN unit SET DEFAULT 'nos';

-- Rebuild every recipe from its item's unit, so text and column agree.
WITH rebuilt AS (
  SELECT mi.id,
         string_agg(
           btrim(split_part(ch.chunk, ':', 1)) || ':'
             || btrim(regexp_replace(btrim(split_part(ch.chunk, ':', 2)), '\s*[A-Za-z]+\s*$', ''))
             || ' ' || COALESCE(b.unit, 'nos'),
           ';' ORDER BY ch.ord) AS ing
  FROM public.menu_items mi
  CROSS JOIN LATERAL regexp_split_to_table(mi.ingredients, ';') WITH ORDINALITY AS ch(chunk, ord)
  LEFT JOIN public.menu_items b
    ON NOT b.is_customer_visible
   AND lower(b.name) = lower(btrim(split_part(ch.chunk, ':', 1)))
  WHERE mi.is_customer_visible
    AND mi.ingredients IS NOT NULL AND btrim(ch.chunk) <> ''
  GROUP BY mi.id)
UPDATE public.menu_items m SET ingredients = r.ing
  FROM rebuilt r WHERE m.id = r.id AND m.ingredients IS DISTINCT FROM r.ing;

-- The two RPCs that validate a unit.
CREATE OR REPLACE FUNCTION public.admin_create_menu_block(
  p_name TEXT, p_price NUMERIC, p_branch_id INTEGER, p_unit TEXT DEFAULT 'nos'
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
    (name, price, unit, cycle_id, ingredients, is_active, is_customer_visible, branch_id, sort_order)
  VALUES
    (btrim(p_name), COALESCE(p_price, 0),
     CASE WHEN p_unit IN ('nos','gms','ml','cup','plate','bowl') THEN p_unit ELSE 'nos' END,
     NULL, NULL, TRUE, FALSE, p_branch_id, 0)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL   ON FUNCTION public.admin_create_menu_block(TEXT, NUMERIC, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_menu_block(TEXT, NUMERIC, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_menu_block_unit(p_id INTEGER, p_unit TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name TEXT; v_recipes INTEGER := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only.'; END IF;
  IF p_unit NOT IN ('nos','gms','ml','cup','plate','bowl') THEN
    RAISE EXCEPTION 'Unknown unit "%".', p_unit;
  END IF;

  SELECT name INTO v_name FROM public.menu_items WHERE id = p_id AND NOT is_customer_visible;
  IF NOT FOUND THEN RAISE EXCEPTION 'Menu item not found.'; END IF;

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
    WHERE mi.is_customer_visible AND mi.ingredients IS NOT NULL AND btrim(ch.chunk) <> ''
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
-- Reverse the two UPDATEs and re-run menu_item_units.sql.
