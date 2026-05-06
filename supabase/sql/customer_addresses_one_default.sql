-- ─────────────────────────────────────────────────────────────
-- BF-30 (2026-05-06): customer_addresses single-default invariant
--
-- AddAddressScreen historically inserted every new address with
-- `is_default = TRUE`, never clearing the previous default. Result:
-- users with ≥2 addresses ended up with multiple rows flagged default,
-- and AddressesScreen's "Set default" toggle (rendered only on
-- non-default rows) had no surface to render — the user got stuck.
--
-- Fix has three parts. The client-side fix (only mark first-ever
-- address as default on insert) lives in src/screens/customer/
-- AddAddressScreen.tsx. The two SQL pieces below close the loop:
--
--   1. Backfill — for every user with multiple defaults, keep the
--      most-recent (by created_at, tie-broken by id) and clear the
--      rest. No data loss; only flips is_default → FALSE on stale
--      duplicates.
--
--   2. Partial unique index — at most one default address per
--      user_id at the DB level. Prevents recurrence even if a future
--      code path forgets the existence check. The existing
--      useSetDefaultAddress flow (clear-all then set-one) plays
--      nicely with this — sequential statements within a single
--      mutation, no overlap.
--
-- Idempotent. Safe to re-run. Run order matters: backfill first,
-- index second — else CREATE UNIQUE INDEX fails on existing dupes.
-- ─────────────────────────────────────────────────────────────

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
    FROM public.customer_addresses
   WHERE is_default = TRUE
)
UPDATE public.customer_addresses ca
   SET is_default = FALSE
  FROM ranked r
 WHERE ca.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_one_default_per_user
    ON public.customer_addresses (user_id)
 WHERE is_default = TRUE;
