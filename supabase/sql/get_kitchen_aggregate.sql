-- ============================================================
-- 1stOne F1 — kitchen aggregation, server-side (audit D5)
-- Applied to live DB 2026-05-19.
--
-- Moves StaffDashboard's on-device aggregateKitchenItems / parse logic
-- to the server (standard #2). For the active staff batch's food orders
-- it breaks each ordered meal into its menu_items.ingredients components
-- ("Rice:200g;Sambar:100ml;Chapati:2"), multiplies by order quantity,
-- and aggregates by component + unit + status.
--
-- 1:1 port of the TS logic — verified byte-identical against live data
-- (fallback path) and synthetic ingredient strings (parse path) before
-- shipping. SECURITY INVOKER: RLS scopes rows to the caller.
--
-- Token grammar (mirrors /^(\d*\.?\d+)\s*(.*)$/): a leading number + unit
-- suffix ("200g"→200/"g", "2"→2/""); a non-numeric token counts as 1.
-- A meal with no ingredients falls back to the meal itself × its qty.
-- ============================================================

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
           oi.quantity, mi.ingredients
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
    -- No ingredients defined → fallback: the meal itself, token = its qty.
    SELECT order_id, status,
           COALESCE(item_name, 'Item #' || item_id) AS comp_name,
           quantity::text AS token,
           1 AS mult
    FROM food_items
    WHERE ingredients IS NULL OR btrim(ingredients) = ''
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
