/**
 * 1stOne F1 — Constants
 *
 * App-wide constants. NO hardcoded business values here —
 * business rules come from Supabase (store_config, feature_flags, delivery_cycles).
 * Only technical/display constants belong here.
 */

/** AsyncStorage keys */
export const STORAGE_KEYS = {
  CART: '1stone-cart',
  ESSENTIALS_CART: '1stone-essentials-cart',
  STAFF_QUEUE: '1stone-staff-queue',
  PUSH_TOKEN: '1stone-push-token',
} as const;

/** TanStack Query keys (centralized to avoid typo collisions) */
export const QUERY_KEYS = {
  STORE_CONFIG: ['store_config'] as const,
  FEATURE_FLAGS: ['feature_flags'] as const,
  DELIVERY_CYCLES: ['delivery_cycles'] as const,
  MENU_ITEMS: ['menu_items'] as const,
  ESSENTIALS: ['essentials_catalog'] as const,
  ORDERS: ['orders'] as const,
  MY_ORDERS: ['orders', 'mine'] as const,
  SUBSCRIPTIONS: ['user_subscriptions'] as const,
  SUBSCRIPTION_PLANS: ['subscription_plans'] as const,
  ADDRESSES: ['customer_addresses'] as const,
  WALLET: ['wallet_transactions'] as const,
  BANNERS: ['banners'] as const,
  PROFILE: ['profiles'] as const,
  STAFF_ORDERS: ['orders', 'staff'] as const,
  STAFF_ATTENDANCE: ['staff_attendance'] as const,
  STAFF_LEAVES: ['staff_leaves'] as const,
  ADMIN_NOTES: ['admin_notes'] as const,
  BRANCHES: ['branches'] as const,
  HUBS: ['delivery_hubs'] as const,
  ZONES: ['delivery_zones'] as const,
  REFERRALS: ['referrals'] as const,
  EXPENSE_CLAIMS: ['expense_claims'] as const,
  SERVER_TIME: ['server_time'] as const,
} as const;

/** Supabase Storage bucket names */
export const BUCKETS = {
  BANNERS: 'banners',
  LOGOS: 'logos',
  ROUTE_MAPS: 'route-maps',
} as const;

/** Order status flow */
export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled',
] as const;

/** Max retry for offline queue before flagging */
export const MAX_QUEUE_RETRIES = 5;

/** Stale time for TanStack Query (ms) */
export const QUERY_STALE_TIME = 2 * 60 * 1000; // 2 minutes
