/**
 * 1stOne F1 — invalidateOrderQueries
 *
 * Single source of truth for "what query caches need to be invalidated when
 * an order's server state changes." Called from every order-mutating hook
 * (useUpdateOrderStatus, useAdminCancelOrder) so the UI on whichever screen
 * the user happens to be on — or returns to — re-renders with the new
 * server state without manual refetch.
 *
 * Why centralized: order data is read by 5+ surfaces today (Staff Kitchen
 * + Packing, Hub, Driver, Customer "My Orders", Admin Manage Running Orders,
 * Admin Order Detail). Each had its own query key; mutations were
 * invalidating only a subset, leading to "tap status pill, nothing visibly
 * changes until I navigate away and back" bugs. BF-09 collected the
 * canonical key list here.
 *
 * When adding a new screen that fetches orders with its own query key,
 * append the key to the list below.
 */

import type { QueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../utils/constants';

export function invalidateOrderQueries(queryClient: QueryClient) {
  // Staff/Hub dashboards (shared useStaffOrders hook; partial-match
  // invalidates all branch/cycle/hub variants of the key)
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_ORDERS });

  // Customer "My Orders" + customer Order Detail
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ORDERS });

  // Driver dashboard (own query, own key)
  queryClient.invalidateQueries({ queryKey: ['driver_orders'] });

  // Admin order surfaces — legacy useAdminOrders + BF-08 list + BF-08 detail
  queryClient.invalidateQueries({ queryKey: ['admin_orders'] });
  queryClient.invalidateQueries({ queryKey: ['admin_orders_manage'] });
  queryClient.invalidateQueries({ queryKey: ['admin_order_detail'] });

  // Admin home stats (today's order count etc.)
  queryClient.invalidateQueries({ queryKey: ['admin_stats'] });
}
