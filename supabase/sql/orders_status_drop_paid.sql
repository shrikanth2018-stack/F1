-- ============================================================
-- 1stOne F1 — drop dead 'Paid' order status (audit D16b)
-- Applied to live DB 2026-05-19.
--
-- BF-32a made both the webhook and confirm-order write 'Confirmed';
-- nothing writes 'Paid' any more (verified: 0 rows). Removing it from
-- the CHECK constraint stops a dead value re-entering via a bad write.
-- ============================================================

ALTER TABLE public.orders DROP CONSTRAINT orders_status_allowed;

ALTER TABLE public.orders ADD CONSTRAINT orders_status_allowed
  CHECK (status = ANY (ARRAY[
    'Pending', 'Confirmed', 'Preparing', 'Ready', 'Packed',
    'Dispatched', 'Received at Hub', 'On the Way', 'Delivered',
    'Cancelled', 'Failed'
  ]::text[]));
