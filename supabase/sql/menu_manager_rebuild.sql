-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Menu Manager rebuild: server side (2026-08-03)
--
-- Two kinds of row in menu_items, made explicit and then enforced:
--
--   BLOCK  is_customer_visible = FALSE, cycle_id NULL, no recipe.
--          A priced ingredient — Idli, Sambar, Rice. Sold only when a bulk
--          order pulls it on its own.
--   DISH   is_customer_visible = TRUE, cycle_id NOT NULL, has a recipe.
--          What a customer sees and buys.
--
-- WHY BLOCKS LOSE THEIR CYCLE. They only had one because the old composer
-- offered blocks from the cycle being composed, which forced a separate row
-- per cycle: 49 rows for 34 names, with Dal, Papad, Curry and Chapati twice
-- and Gobi Manchurian three times. An ingredient is not a mealtime. The order
-- path already agrees — admin-place-order collapses every bulk line into the
-- cycle the ADMIN picked, regardless of what the item is catalogued under.
--
-- Run AFTER this: the matching change in _shared/orderBuild.ts, which stops
-- requiring a cycle on the admin path. Cycle-less blocks against the old
-- builder make bulk orders fail with "not assigned to a delivery cycle".
--
-- Deploy: supabase db query --linked --file supabase/sql/menu_manager_rebuild.sql
-- Idempotent. Safe to re-run.
-- Rollback: at the bottom.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Name casing ─────────────────────────────────────────────
-- Three inconsistencies. Dishes carry no references (only BLOCK names appear
-- inside recipes), so renaming a dish is a plain update.
-- Left alone on purpose: "Daal+ Rice" and "Chitrannha" are spellings, not
-- mistakes — the owner's wording, not something to normalise silently.

UPDATE public.menu_items SET name = 'Schezwan Fried Rice' WHERE name = 'schezwan fried rice';
UPDATE public.menu_items SET name = 'Potato Fry'          WHERE name = 'Potato fry';
UPDATE public.menu_items SET name = 'Juice of the Day'    WHERE name = 'Juice of the day';

-- ── 2. Collapse duplicate blocks ───────────────────────────────
-- Keep the lowest id per name. Recipes reference blocks by NAME, never by id,
-- so nothing needs repointing — the duplicates are simply redundant rows.

DELETE FROM public.menu_items d
WHERE NOT d.is_customer_visible
  AND EXISTS (
    SELECT 1 FROM public.menu_items k
    WHERE NOT k.is_customer_visible
      AND lower(k.name) = lower(d.name)
      AND k.id < d.id
  );

-- ── 3. A block belongs to no cycle ─────────────────────────────
UPDATE public.menu_items SET cycle_id = NULL WHERE NOT is_customer_visible;

-- Alphabetical, so Step 1 reads as a list you can scan rather than in
-- whatever order the importer happened to insert.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY lower(name)) AS rn
  FROM public.menu_items WHERE NOT is_customer_visible)
UPDATE public.menu_items m SET sort_order = o.rn FROM ordered o WHERE m.id = o.id;

-- ── 3b. Point every recipe at a block name that actually exists ──
--
-- §1 renamed rows directly, and 'schezwan fried rice' was BOTH a dish and a
-- block — so the block became 'Schezwan Fried Rice' while the recipe still
-- said 'schezwan fried rice', leaving a recipe naming a block that no longer
-- existed. Caught in the dry run.
--
-- Rather than patch that one case, this canonicalises every component name to
-- the block's exact spelling, matched case-insensitively. After it, every
-- component in every recipe resolves to a real block — which is the invariant
-- the Step 2 editor depends on to show a recipe as pickable items rather than
-- as text it cannot match.
WITH canon AS (
  SELECT lower(name) AS lname, name FROM public.menu_items WHERE NOT is_customer_visible
), rebuilt AS (
  SELECT mi.id,
         string_agg(
           COALESCE(c.name, btrim(split_part(ch.chunk, ':', 1)))
             || ':' || btrim(split_part(ch.chunk, ':', 2)),
           ';' ORDER BY ch.ord) AS ing
  FROM public.menu_items mi
  CROSS JOIN LATERAL regexp_split_to_table(mi.ingredients, ';') WITH ORDINALITY AS ch(chunk, ord)
  LEFT JOIN canon c ON c.lname = lower(btrim(split_part(ch.chunk, ':', 1)))
  WHERE mi.is_customer_visible
    AND mi.ingredients IS NOT NULL AND btrim(ch.chunk) <> ''
  GROUP BY mi.id)
UPDATE public.menu_items m
   SET ingredients = r.ing
  FROM rebuilt r
 WHERE m.id = r.id AND m.ingredients IS DISTINCT FROM r.ing;

-- ── 4. Make the two shapes impossible to break ─────────────────
-- The distinction was a convention until now, which is why the duplication
-- crept in. These are what stop it happening again.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_shape') THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_shape CHECK (
      (is_customer_visible AND cycle_id IS NOT NULL)
      OR (NOT is_customer_visible AND cycle_id IS NULL)
    );
  END IF;
END $$;

-- One block per name, and one dish per name per cycle. The kitchen aggregates
-- prep BY NAME, so two rows sharing a name inside one cycle would merge into a
-- single prep line and quietly under-cook one of them.
CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_block_name
  ON public.menu_items (lower(name)) WHERE NOT is_customer_visible;

CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_dish_name_cycle
  ON public.menu_items (lower(name), cycle_id) WHERE is_customer_visible;

-- ── 5. How many menus use a block ──────────────────────────────
-- Drives "used in 9 menus" in the editor, so disabling or renaming is never a
-- blind action. Exact match on the name part of each ';' chunk — see §6 for
-- why a LIKE would be wrong.

CREATE OR REPLACE FUNCTION public.menu_block_usage(p_name TEXT)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(DISTINCT mi.id)::INTEGER
  FROM public.menu_items mi,
       LATERAL regexp_split_to_table(COALESCE(mi.ingredients, ''), ';') AS chunk
  WHERE mi.is_customer_visible
    AND btrim(chunk) <> ''
    AND lower(btrim(split_part(chunk, ':', 1))) = lower(btrim(p_name));
$$;
REVOKE ALL   ON FUNCTION public.menu_block_usage(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_block_usage(TEXT) TO authenticated;

-- ── 6. Rename a block, and every recipe that names it ──────────
--
-- NEVER a string replace. Checked against real data, eight names contain
-- another block's name:
--
--   'Rice'       is inside Curd Rice, Fried Rice, Rice Pullav,
--                Paneer Fried Rice, Schezwan Fried Rice
--   'Fried Rice' is inside Paneer Fried Rice, Schezwan Fried Rice
--   'Sweet'      is inside Sweet Corn
--
-- So renaming 'Rice' with replace() would corrupt five other recipes. This
-- splits each recipe on ';', compares the NAME part exactly, and rebuilds —
-- the quantity and its unit are carried across untouched.

CREATE OR REPLACE FUNCTION public.admin_rename_menu_block(p_old TEXT, p_new TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_recipes INTEGER := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only.';
  END IF;
  IF COALESCE(btrim(p_new), '') = '' THEN
    RAISE EXCEPTION 'Enter a name.';
  END IF;
  IF position(':' IN p_new) > 0 OR position(';' IN p_new) > 0 THEN
    RAISE EXCEPTION 'A name cannot contain ":" or ";" — they separate the parts of a recipe.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.menu_items
             WHERE NOT is_customer_visible
               AND lower(name) = lower(btrim(p_new))
               AND lower(name) <> lower(btrim(p_old))) THEN
    RAISE EXCEPTION 'An item called "%" already exists.', btrim(p_new);
  END IF;

  UPDATE public.menu_items
     SET name = btrim(p_new)
   WHERE NOT is_customer_visible AND lower(name) = lower(btrim(p_old));

  WITH rebuilt AS (
    SELECT mi.id,
           string_agg(
             CASE WHEN lower(btrim(split_part(c.chunk, ':', 1))) = lower(btrim(p_old))
                  THEN btrim(p_new) || ':' || btrim(split_part(c.chunk, ':', 2))
                  ELSE btrim(c.chunk) END,
             ';' ORDER BY c.ord) AS ing
    FROM public.menu_items mi,
         LATERAL regexp_split_to_table(mi.ingredients, ';') WITH ORDINALITY AS c(chunk, ord)
    WHERE mi.is_customer_visible
      AND mi.ingredients IS NOT NULL AND btrim(mi.ingredients) <> ''
      AND btrim(c.chunk) <> ''
    GROUP BY mi.id)
  UPDATE public.menu_items m
     SET ingredients = r.ing
    FROM rebuilt r
   WHERE m.id = r.id AND m.ingredients IS DISTINCT FROM r.ing;

  GET DIAGNOSTICS v_recipes = ROW_COUNT;
  RETURN v_recipes;
END $$;
REVOKE ALL   ON FUNCTION public.admin_rename_menu_block(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rename_menu_block(TEXT, TEXT) TO authenticated;

-- ── 7. Remove: delete if never sold, retire if it was ──────────
-- order_items references menu_items. Hard-deleting something that was ordered
-- leaves gaps in past order details and in the revenue report, so the caller
-- is told which of the two happened rather than having to guess.

CREATE OR REPLACE FUNCTION public.admin_remove_menu_item(p_id INTEGER)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.menu_items; v_used INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only.';
  END IF;

  SELECT * INTO v_row FROM public.menu_items WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found.';
  END IF;
  IF NOT public.has_branch_access(v_row.branch_id) THEN
    RAISE EXCEPTION 'That item belongs to another branch.';
  END IF;

  -- A block still named by a live recipe must not vanish underneath it.
  IF NOT v_row.is_customer_visible THEN
    v_used := public.menu_block_usage(v_row.name);
    IF v_used > 0 THEN
      RAISE EXCEPTION 'Still used by % menu(s). Remove it from those first.', v_used;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_items WHERE item_id = p_id
               AND (item_type IS NULL OR item_type = 'food')) THEN
    UPDATE public.menu_items SET is_active = FALSE WHERE id = p_id;
    RETURN 'retired';
  END IF;

  DELETE FROM public.menu_items WHERE id = p_id;
  RETURN 'deleted';
END $$;
REVOKE ALL   ON FUNCTION public.admin_remove_menu_item(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_menu_item(INTEGER) TO authenticated;

-- ── 8. Create a block ──────────────────────────────────────────
-- An RPC rather than a plain insert so cycle_id and is_customer_visible are
-- set by the server: the shape constraint in §4 makes a wrong client insert a
-- hard error, and this is the path that cannot get it wrong.

CREATE OR REPLACE FUNCTION public.admin_create_menu_block(
  p_name TEXT, p_price NUMERIC, p_branch_id INTEGER
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
    (name, price, cycle_id, ingredients, is_active, is_customer_visible, branch_id, sort_order)
  VALUES
    (btrim(p_name), COALESCE(p_price, 0), NULL, NULL, TRUE, FALSE, p_branch_id, 0)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;
REVOKE ALL   ON FUNCTION public.admin_create_menu_block(TEXT, NUMERIC, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_menu_block(TEXT, NUMERIC, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Rollback ───────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.admin_create_menu_block(TEXT, NUMERIC, INTEGER);
-- DROP FUNCTION IF EXISTS public.admin_remove_menu_item(INTEGER);
-- DROP FUNCTION IF EXISTS public.admin_rename_menu_block(TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.menu_block_usage(TEXT);
-- DROP INDEX IF EXISTS ux_menu_dish_name_cycle;
-- DROP INDEX IF EXISTS ux_menu_block_name;
-- ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_shape;
-- Deleted duplicate blocks and the cleared cycle_ids are NOT restorable from
-- here — see ~/1stone-backups/ for the pre-wipe snapshot of menu_items.
