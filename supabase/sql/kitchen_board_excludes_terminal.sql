-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — a delivered order is not on the prep board
--
-- THE BUG. The Kitchen tab and the Packing tab decide what is on the board in
-- two different places, and they disagreed about DELIVERED.
--
--   Packing   useStaffOrders, on the device:  .filter(o => o.status !== 'Delivered')
--   Kitchen   get_kitchen_aggregate, in SQL:  AND o.status <> 'Cancelled'
--
-- So an order that had been cooked, packed, dispatched and handed to the
-- customer stayed on the prep board as its own line, grouped under status
-- 'Delivered', for as long as its batch was live. Found on the live Snacks /
-- 12 Aug batch: two delivered orders (#11649, #11650) on the kitchen board and
-- correctly absent from packing.
--
-- Harmless in the sense that the row cannot be acted on — the status toggle is
-- enabled only for Confirmed and Preparing, and "Mark all as Ready" takes its
-- ids from Confirmed/Preparing too. Not harmless in the sense that matters:
-- the prep board is a list of food to make, and it was listing food already
-- eaten. A cook reading quantities off it has to know to discount some lines.
--
-- THE FIX. One clause. Terminal statuses come off the prep board, which is
-- what the packing side already did.
--
-- 'Failed' joins them for the same reason: payment failed, so there is no sale
-- and nothing to cook. It could reach this board because the aggregate queries
-- orders by cycle+date directly, while push_kitchen_summary counts only
-- Confirmed and Preparing — the two never had to agree before.
--
-- REBUILT FROM THE LIVE DEFINITION, not from kitchen_aggregate_blocks.sql.
-- Two files in this folder have defined this function and only the deployed
-- one is authoritative; the body below is pg_get_functiondef output with
-- exactly one line changed. Diff it against the live definition before
-- applying if you want to see that for yourself.
--
-- SUPERSEDES the function body in kitchen_aggregate_blocks.sql. Re-apply this
-- after that one if that one is ever edited — whichever runs last wins, the
-- same trap as the push_kitchen_summary pair in §30.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- Dry-run inside BEGIN … ROLLBACK first; there is one database.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_kitchen_aggregate(p_cycle_id bigint, p_dispatch_date date)
 RETURNS TABLE(item_name text, unit text, total_quantity double precision, status text, order_ids bigint[])
 LANGUAGE sql
 STABLE
AS $function$
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
      AND o.status NOT IN ('Delivered', 'Cancelled', 'Failed')
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
$function$
;

NOTIFY pgrst, 'reload schema';
