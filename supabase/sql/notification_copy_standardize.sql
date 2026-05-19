-- ============================================================
-- 1stOne F1 — Notification copy standardisation + catalog completion
-- Applied to live DB 2026-05-20.
--
-- (1) Standardises the 15 customer notification templates to one voice:
--     Title Case titles (no '!' — reads shouty), warm sentence-case
--     bodies, '!' reserved for genuine customer wins.
--
-- (2) Adds the 2 admin-alert events that the code fires
--     (place-order / cancel-order) but had no template row — so they
--     are visible + editable in Notification Manager instead of using
--     hardcoded fallback copy.
--
-- All copy stays admin-editable via NotificationManagerScreen.
-- ============================================================

-- ── (1) Standardised customer copy ──────────────────────────
UPDATE notification_templates SET
  title_template = 'Order Confirmed',
  body_template  = 'Your order #{{order_id}} is confirmed — we''re preparing it now.',
  updated_at = now()
WHERE event_key = 'order.confirmed';

UPDATE notification_templates SET
  title_template = 'Order Confirmed',
  body_template  = 'Payment received — order #{{order_id}} is confirmed and being prepared.',
  updated_at = now()
WHERE event_key = 'order.razorpay_confirmed';

UPDATE notification_templates SET
  title_template = 'Order Ready',
  body_template  = 'Order #{{order_id}} is packed and ready for dispatch.',
  updated_at = now()
WHERE event_key = 'order.ready';

UPDATE notification_templates SET
  title_template = 'On the Way',
  body_template  = 'Your order #{{order_id}} is on the way — see you soon!',
  updated_at = now()
WHERE event_key = 'order.dispatched';

UPDATE notification_templates SET
  title_template = 'Arrived at Your Hub',
  body_template  = 'Order #{{order_id}} has reached your pickup hub.',
  updated_at = now()
WHERE event_key = 'order.received_at_hub';

UPDATE notification_templates SET
  title_template = 'Order Delivered',
  body_template  = 'Order #{{order_id}} delivered. Enjoy your meal!',
  updated_at = now()
WHERE event_key = 'order.delivered';

UPDATE notification_templates SET
  title_template = 'Order Cancelled',
  body_template  = 'Order #{{order_id}} has been cancelled.',
  updated_at = now()
WHERE event_key = 'order.cancelled';

UPDATE notification_templates SET
  title_template = 'Payment Failed',
  body_template  = 'We couldn''t process payment for order #{{order_id}}. Please try again.',
  updated_at = now()
WHERE event_key = 'order.payment_failed';

UPDATE notification_templates SET
  title_template = 'Subscription Active',
  body_template  = 'Your {{plan_name}} subscription is active — enjoy your meals!',
  updated_at = now()
WHERE event_key = 'subscription.activated';

UPDATE notification_templates SET
  title_template = 'Subscription Starts Tomorrow',
  body_template  = 'Your {{plan_name}} subscription starts tomorrow — first delivery is on the way.',
  updated_at = now()
WHERE event_key = 'subscription.starting_tomorrow';

UPDATE notification_templates SET
  title_template = 'Subscription Ending Soon',
  body_template  = 'Your {{plan_name}} subscription ends in 2 days. Renew now to keep your meals coming.',
  updated_at = now()
WHERE event_key = 'subscription.ending_2d';

UPDATE notification_templates SET
  title_template = 'Subscription Ending Tomorrow',
  body_template  = 'Your {{plan_name}} subscription ends tomorrow. Renew now to stay uninterrupted.',
  updated_at = now()
WHERE event_key = 'subscription.ending_1d';

UPDATE notification_templates SET
  title_template = 'Wallet Topped Up',
  body_template  = '₹{{amount}} has been added to your wallet.',
  updated_at = now()
WHERE event_key = 'wallet.topped_up';

UPDATE notification_templates SET
  title_template = 'Low Wallet Balance',
  body_template  = 'Add ₹{{shortfall}} to your wallet before your {{plan_name}} subscription renews.',
  updated_at = now()
WHERE event_key = 'wallet.low_balance';

UPDATE notification_templates SET
  title_template = 'We''ve Missed You',
  body_template  = 'Your next meal is just a tap away — see what''s fresh today.',
  updated_at = now()
WHERE event_key = 'winback.dormant';

-- ── (2) Admin-alert events — fired by code, were missing a row ──
INSERT INTO notification_templates
  (event_key, title_template, body_template, is_enabled, trigger_source, description, variables)
VALUES
  ('admin.subscription_create_failed',
   'Subscription Not Created',
   'Order #{{order_id}} was paid but {{count}} subscription(s) failed to create. Manual reconciliation needed (ref {{reference}}).',
   true, 'admin_alert',
   'Admin alert — a paid order''s subscription rows failed to insert. Keep enabled.',
   ARRAY['order_id', 'count', 'reference']),
  ('admin.wallet_refund_failed',
   'Wallet Refund Failed',
   'Order #{{order_id}} was cancelled but the ₹{{amount}} wallet refund did not credit. Manual reconciliation needed (ref {{reference}}).',
   true, 'admin_alert',
   'Admin alert — a cancellation''s wallet refund failed to credit. Keep enabled.',
   ARRAY['order_id', 'amount', 'reference'])
ON CONFLICT (event_key) DO NOTHING;
