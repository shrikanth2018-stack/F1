-- ═══════════════════════════════════════════════════════════════════════
-- 1stOne F1 — covering indexes on the foreign keys that will be joined
--                                                            (2026-08-17)
--
-- Pure addition. An index changes no result, only how fast it is reached.
--
-- 45 foreign keys in this schema have no index on the referencing column. That
-- number was worth checking twice: the first query written for it reported 97
-- and named `profiles.id` — the primary key — which is how it was caught.
-- `pg_index.indkey` is an int2vector, so casting it to int2[] yields a
-- ZERO-based array; the leading N columns are `[0 : N-1]`, not `[1 : N]`. The
-- corrected count is 45, and the busiest joins — `order_items.order_id`,
-- `orders.user_id` — turned out to be indexed already.
--
-- ONLY THE ONES THAT WILL ACTUALLY GROW ARE INDEXED HERE. The other 36 sit on
-- configuration and back-office tables with single-digit row counts, where an
-- index costs something on every write and buys nothing on read for years. A
-- list of every index one COULD create is not a to-do list.
--
-- Today all of these tables are small (0 orders on the live database at time
-- of writing), so every statement below is instantaneous. That is precisely
-- why now is the moment: the same statements against a year of orders would
-- want CONCURRENTLY and a quiet window.
--
-- Deploy: supabase db query --linked --file supabase/sql/fk_covering_indexes.sql
-- Idempotent (IF NOT EXISTS). Re-running changes nothing.
-- Rollback: DROP INDEX for any of the names below — always safe.
-- ═══════════════════════════════════════════════════════════════════════

-- Which door an order goes to. Read on every order detail, slip and driver
-- board; also the parent of a per-address lookup in the manifest.
CREATE INDEX IF NOT EXISTS idx_orders_delivery_address_id
  ON public.orders (delivery_address_id);

-- The vendor money trail. `credit_vendor_earnings_for_order` filters by order
-- on every delivery, and reconciliation walks back from the wallet row.
CREATE INDEX IF NOT EXISTS idx_vendor_earnings_order_id
  ON public.vendor_earnings (order_id);
CREATE INDEX IF NOT EXISTS idx_vendor_earnings_wallet_transaction_id
  ON public.vendor_earnings (wallet_transaction_id);

-- A vendor's "mark ready" list, joined per order.
CREATE INDEX IF NOT EXISTS idx_vendor_order_fulfilment_order_id
  ON public.vendor_order_fulfilment (order_id);

-- Ratings are written per order line and read per customer. Both sides grow
-- with every delivered order.
CREATE INDEX IF NOT EXISTS idx_order_item_ratings_order_item_id
  ON public.order_item_ratings (order_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_ratings_user_id
  ON public.order_item_ratings (user_id);

-- Skipped subscription days: checked once per subscription per manifest run,
-- i.e. once a minute per active plan, forever.
CREATE INDEX IF NOT EXISTS idx_cancelled_subscription_days_cycle_id
  ON public.cancelled_subscription_days (cycle_id);

-- Attendance is one row per staff member per day and is always read
-- branch-scoped.
CREATE INDEX IF NOT EXISTS idx_staff_attendance_branch_id
  ON public.staff_attendance (branch_id);

-- A vendor's proposed changes, listed per vendor on both the vendor's screen
-- and the admin review queue.
CREATE INDEX IF NOT EXISTS idx_vendor_listing_changes_vendor_id
  ON public.vendor_listing_changes (vendor_id);


-- ── Report: the foreign keys still without a covering index ────────────
-- Expected to list only the small configuration / back-office tables named in
-- the header. Anything on orders, order_items, vendor_earnings,
-- customer_addresses, user_subscriptions or wallet_transactions appearing here
-- is a miss worth a second look.
WITH fk AS (
  SELECT c.conrelid, c.conrelid::regclass::text AS tbl, c.conkey,
         array_length(c.conkey, 1) AS n
  FROM pg_constraint c
  WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
)
SELECT f.tbl || '(' ||
       (SELECT string_agg(a.attname, ',' ORDER BY x.ord)
          FROM unnest(f.conkey) WITH ORDINALITY x(att, ord)
          JOIN pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = x.att)
       || ')' AS still_uncovered
FROM fk f
WHERE NOT EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indrelid = f.conrelid
    AND (i.indkey::int2[])[0:f.n-1] = f.conkey
)
ORDER BY 1;
