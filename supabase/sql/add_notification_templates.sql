-- 1stOne F1 — Notification Templates
--
-- Admin-editable push templates, keyed by a stable event_key.
-- Edge functions resolve templates at send time; fall back to hardcoded
-- defaults when a row is missing, and skip when is_enabled=false.
--
-- Template strings may contain {{variable}} placeholders; substituted by the
-- shared helper in _shared/notifications.ts.
--
-- Run once in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS notification_templates (
  event_key       TEXT        PRIMARY KEY,
  title_template  TEXT        NOT NULL,
  body_template   TEXT        NOT NULL,
  is_enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  trigger_source  TEXT,
  description     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed — matches Phase 1 push firings.
INSERT INTO notification_templates (event_key, title_template, body_template, trigger_source, description)
VALUES
  ('order.confirmed',           'Order Confirmed!',     'Your order #{{order_id}} is confirmed. We are getting it ready!',                'order_status',          'Fires right after wallet/Razorpay payment is captured.'),
  ('order.razorpay_confirmed',  'Order Confirmed!',     'Your order #{{order_id}} payment is confirmed. We are getting it ready!',       'order_status',          'Fires when Razorpay webhook confirms payment.'),
  ('order.ready',               'Order Ready!',         'Order #{{order_id}} is packed and ready for dispatch.',                          'order_status',          'Kitchen finished preparing.'),
  ('order.dispatched',          'On the Way!',          'Your order #{{order_id}} is on the way. Should arrive soon!',                   'order_status',          'Staff marked dispatched.'),
  ('order.received_at_hub',     'At Your Hub',          'Order #{{order_id}} has arrived at your pickup hub.',                            'order_status',          'Branch driver dropped at hub.'),
  ('order.delivered',           'Delivered!',           'Order #{{order_id}} delivered. Enjoy your meal!',                                'order_status',          'Last-mile driver marked delivered.'),
  ('order.cancelled',           'Order Cancelled',      'Order #{{order_id}} has been cancelled.',                                        'order_status',          'Customer or admin cancelled.'),
  ('order.payment_failed',      'Payment Failed',       'Payment for order #{{order_id}} could not be processed. Please try again.',     'order_status',          'Razorpay webhook flagged failure.'),
  ('wallet.topped_up',          'Wallet Topped Up!',    '₹{{amount}} has been added to your wallet.',                                    'wallet_topup',          'Razorpay wallet-topup captured.'),
  ('wallet.low_balance',        'Low Wallet Balance',   'Top up ₹{{shortfall}} before your {{plan_name}} subscription auto-renews.',     'wallet_low',            'Fires when active sub ends in 1–2 days and balance is below threshold.'),
  ('subscription.activated',    'Subscription Activated!', 'Your {{plan_name}} subscription is now active. Enjoy your meals!',           'subscription_activation', 'Fires on wallet/Razorpay capture for a subscription purchase.'),
  ('subscription.starting_tomorrow', 'Subscription Starts Tomorrow', 'Your {{plan_name}} subscription starts tomorrow. First delivery on the way!', 'subscription_starting', 'Fires the day before start_date via cron.'),
  ('subscription.ending_1d',    'Subscription Ending Tomorrow', 'Your {{plan_name}} subscription ends tomorrow. Renew now to stay uninterrupted!', 'subscription_expiry',   'Fires one day before end via cron.'),
  ('subscription.ending_2d',    'Subscription Ending in 2 Days', 'Your {{plan_name}} subscription ends in 2 days. Renew now to keep your meals coming!', 'subscription_expiry', 'Fires two days before end via cron.'),
  ('winback.dormant',           'We''ve missed you',    'Your next meal is just a tap away. Come see what''s fresh today.',              'winback',               'Weekly cron finds dormant customers.')
ON CONFLICT (event_key) DO NOTHING;
