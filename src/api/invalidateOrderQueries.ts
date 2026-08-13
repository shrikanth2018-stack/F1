/**
 * 1stOne F1 — invalidateOrderQueries
 *
 * Single source of truth for "what query caches need to be invalidated when
 * an order's server state changes." Called from every order-mutating hook
 * (useUpdateOrderStatus, useAdminCancelOrder) so the UI on whichever screen
 * the user happens to be on — or returns to — re-renders with the new
 * server state without manual refetch.
 *
 * Why centralized: order data is read by a dozen surfaces today. Each has its
 * own query key; mutations were invalidating only a subset, leading to "tap
 * status pill, nothing visibly changes until I navigate away and back" bugs.
 * BF-09 collected the canonical key list here.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS FILE HAS ASKED TO BE UPDATED AND BEEN IGNORED SIX TIMES.
 *
 * The note below used to say "when adding a new screen that fetches orders
 * with its own query key, append the key to the list." Six were then added
 * without doing so — the admin Undelivered tab, driver history, hub history
 * and its detail, the vendor's order list, and a customer's orders on the
 * admin customer screen.
 *
 * The symptom, reported 2026-08-13: an admin cancels an undelivered order and
 * it STAYS on the Undelivered tab, and does not appear in the driver's or
 * hub's history. Nothing was wrong on the server — `_undelivered_order_ids`
 * already excludes Cancelled, and neither history filters it out. The lists
 * were simply reading a cache nobody had told about the change.
 *
 * A convention that has to be remembered is not a rule, so the keys now live
 * in ONE array with the surface each belongs to named beside it. Adding a
 * screen still means adding a line — but the line is here, next to twelve
 * others, rather than implied by a paragraph.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { QueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../utils/constants';

/**
 * Every cache that shows an order, by key ROOT. TanStack matches on prefix, so
 * a root invalidates all of its variants — every branch, cycle, hub, date and
 * user permutation of that screen's key.
 */
const ORDER_QUERY_ROOTS: readonly (readonly string[])[] = [
  // Staff Kitchen + Packing, and the hub operator's Today board (shared hook)
  QUERY_KEYS.STAFF_ORDERS,
  // Customer My Orders, order detail, the Home rail and my_order_states
  QUERY_KEYS.ORDERS,

  // Driver — the live board, and the history a row falls into when it leaves it
  ['driver_orders'],
  ['driver_order_history'],

  // Hub operator — history list and the single-order drill-down
  ['hub_order_history'],
  ['hub_history_detail'],

  // Vendor — the orders containing their goods
  ['vendor_orders'],

  // Admin — the day list, the Undelivered tab, one order, one customer's orders
  ['admin_orders_manage'],
  ['admin_orders_undelivered'],
  ['admin_order_detail'],
  ['admin_customer_orders'],

  // Admin home counters (today's order count etc.)
  ['admin_stats'],
];

export function invalidateOrderQueries(queryClient: QueryClient) {
  for (const queryKey of ORDER_QUERY_ROOTS) {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}
