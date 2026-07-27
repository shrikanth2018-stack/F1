-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Menu item visibility (two-stage menu model, Slice 1)
--
-- Splits the two roles that already share the menu_items table:
--
--   ITEM       — a priced building block (Idli ₹12). Created in stage 1
--                (CreateItemScreen). is_customer_visible = FALSE,
--                `ingredients` empty. Never appears on the customer menu;
--                it exists so a single part can be priced and (later)
--                ordered on its own from the admin side.
--
--   MENU ITEM  — the customer-facing package (Idli Vada ₹55). Created in
--                stage 2 (CreateMenuScreen) by clubbing items.
--                is_customer_visible = TRUE, `ingredients` carries the
--                recipe as "Idli:2;Vada:1".
--
-- DEFAULT TRUE is deliberate: every pre-existing row keeps exactly its
-- current behaviour, so this file is safe to run BEFORE the matching app
-- release. Old app builds ignore the column entirely.
--
-- Nothing else changes. get_kitchen_aggregate is untouched — it explodes a
-- package's `ingredients` by component NAME, and an item ordered on its own
-- falls through the "no ingredients" path under its own name, so both land
-- on the same prep line. The name match is why item names are treated as
-- stable (there is no rename path in the app, and none should be added).
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- App coupling: run BEFORE the OTA, then `npm run supabase:gen-types`.
-- Rollback: ALTER TABLE public.menu_items DROP COLUMN is_customer_visible;
--           (safe — no other object depends on it).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_customer_visible BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.menu_items.is_customer_visible IS
  'FALSE = building-block item, admin-only (priced part, hidden from the customer menu). TRUE = customer-facing menu item. DEFAULT TRUE preserves every row that pre-dates the two-stage builder.';

-- No index: the customer query already narrows on (cycle_id, is_active)
-- first, and the catalog is in the hundreds of rows. Revisit only if the
-- menu grows by an order of magnitude.

NOTIFY pgrst, 'reload schema';
