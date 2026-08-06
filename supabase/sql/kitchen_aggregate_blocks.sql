-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — The prep board understands a block ordered on its own
-- (2026-08-06)
--
-- WHY THIS EXISTS. Subscription plans are now composed of building-block
-- ITEMS rather than of menus, so a plan's daily dispatch rows are block
-- lines. `get_kitchen_aggregate` explodes a MENU using its recipe; a line
-- with no recipe falls through a fallback that emitted the item's own name
-- with the raw quantity and a BLANK unit.
--
-- The prep board would therefore have shown
--
--     Sambar   |      | 1        ← from the subscription
--     Sambar   | ml   | 150      ← from an à-la-carte Idli Vada
--
-- Two prep lines for one ingredient, because the board groups by
-- (name, unit) — and one of them under-cooked. This is exactly the failure
-- DEPLOY_SQL_ORDER.md §22 warns about, arriving by a new route.
--
-- WHAT CHANGES. Only the no-ingredients fallback, and only when the joined
-- row is a BLOCK (`is_customer_visible = false`): the line is emitted as
-- `quantity × base_quantity` in the block's own unit, so `Sambar × 1`
-- becomes `Sambar 150 ml` and merges with the recipe-derived line.
--
-- Everything else is byte-identical:
--   • a menu WITH a recipe                → unchanged, the recipe path
--   • a customer-visible row with none    → unchanged, count + blank unit
--   • no matching menu_items row at all   → unchanged, count + blank unit
--
-- SAFE AGAINST TODAY'S DATA, checked before writing: **no order_items row
-- currently points at a block**, so this cannot alter any existing board.
-- It does improve the admin bulk-order case, which could already order a
-- block on its own: Sambar ×2 printed "Sambar × 2" and now prints
-- "Sambar 300 ml" — the amount the kitchen actually has to make, and the
-- same reading §23 established for a block's price.
--
-- Deploy: supabase db query --linked --file supabase/sql/kitchen_aggregate_blocks.sql
-- Idempotent. Safe to re-run. Rollback at the bottom.
-- Supersedes: the function body in get_kitchen_aggregate.sql.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_kitchen_aggregate(
  p_cycle_id      bigint,
  p_dispatch_date date
)
RETURNS TABLE (
  item_name      text,
  unit           text,
  total_quantity double precision,
  status         text,
  order_ids      bigint[]
)
LANGUAGE sql
STABLE
AS $$
  WITH food_items AS (
    -- Food order_items of non-cancelled orders in this batch.
    SELECT o.id AS order_id, o.status, oi.item_id, oi.item_name,
           oi.quantity, mi.ingredients,
           -- A block carries its own portion and unit; a dish does not.
           (mi.id IS NOT NULL AND mi.is_customer_visible = FALSE) AS is_block,
           COALESCE(mi.base_quantity, 1)                          AS portion,
           mi.unit                                                AS block_unit
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN menu_items mi ON mi.id = oi.item_id
    WHERE o.cycle_id = p_cycle_id
      AND o.dispatch_date = p_dispatch_date
      AND o.status <> 'Cancelled'
      AND o.order_type = 'food'
      AND (oi.item_type IS NULL OR oi.item_type = 'food')
  ),
  components AS (
    -- A BLOCK ordered directly — from a subscription plan, or a bulk order
    -- buying the part on its own. Its amount is count × its own portion, in
    -- its own unit, so it lands on the SAME prep line as the identical
    -- ingredient arriving inside a dish.
    SELECT order_id, status,
           COALESCE(item_name, 'Item #' || item_id) AS comp_name,
           ((quantity * portion)::text || ' ' || COALESCE(block_unit, '')) AS token,
           1 AS mult
    FROM food_items
    WHERE is_block AND (ingredients IS NULL OR btrim(ingredients) = '')
    UNION ALL
    -- No ingredients and not a block → fallback unchanged: the meal itself,
    -- token = its qty, no unit.
    SELECT order_id, status,
           COALESCE(item_name, 'Item #' || item_id) AS comp_name,
           quantity::text AS token,
           1 AS mult
    FROM food_items
    WHERE NOT is_block AND (ingredients IS NULL OR btrim(ingredients) = '')
    UNION ALL
    -- Ingredients defined → one component per ';'-chunk, "name:token".
    SELECT fi.order_id, fi.status, c.comp_name, c.token, fi.quantity
    FROM food_items fi
    CROSS JOIN LATERAL (
      SELECT btrim(split_part(chunk, ':', 1)) AS comp_name,
             COALESCE(NULLIF(btrim(split_part(chunk, ':', 2)), ''), '1') AS token
      FROM regexp_split_to_table(fi.ingredients, ';') AS chunk
      WHERE btrim(chunk) <> ''
    ) c
    WHERE fi.ingredients IS NOT NULL AND btrim(fi.ingredients) <> ''
      AND c.comp_name <> ''
  ),
  valued AS (
    SELECT order_id, status, comp_name,
           regexp_match(token, '^([0-9]*\.?[0-9]+)\s*(.*)$') AS m,
           mult
    FROM components
  )
  SELECT
    comp_name AS item_name,
    CASE WHEN m IS NULL THEN '' ELSE btrim(m[2]) END AS unit,
    SUM((CASE WHEN m IS NULL THEN 1 ELSE m[1]::numeric END) * mult)::double precision
      AS total_quantity,
    status,
    array_agg(DISTINCT order_id ORDER BY order_id) AS order_ids
  FROM valued
  GROUP BY comp_name, (CASE WHEN m IS NULL THEN '' ELSE btrim(m[2]) END), status
  ORDER BY
    array_position(
      ARRAY['Pending','Confirmed','Preparing','Ready','Packed',
            'Dispatched','Received at Hub','On the Way','Delivered'],
      status
    ),
    comp_name;
$$;

REVOKE ALL ON FUNCTION public.get_kitchen_aggregate(bigint, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kitchen_aggregate(bigint, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Verification ───────────────────────────────────────────────
-- Nothing points at a block today, so the first query must return zero rows
-- BEFORE any block-based plan dispatches — that is what makes this a no-op
-- against existing data.
--
--   SELECT count(*) FROM order_items oi
--     JOIN menu_items m ON m.id = oi.item_id
--    WHERE oi.item_type = 'food' AND NOT m.is_customer_visible;
--
-- After a block-based plan has dispatched, one ingredient must be ONE row:
--
--   SELECT * FROM get_kitchen_aggregate(<cycle_id>, '<YYYY-MM-DD>');
--     -- expect: Sambar | ml | <summed>
--     -- NOT:    Sambar | '' | 1   plus   Sambar | ml | 150

-- ── Rollback ───────────────────────────────────────────────────
-- Re-run supabase/sql/get_kitchen_aggregate.sql, which restores the single
-- no-ingredients fallback. Only safe while no plan holds block ids.
