/**
 * 1stOne F1 — Order status taxonomy (single source — audit D19).
 *
 * The canonical status set, its fulfilment progression order, and the
 * status→badge-variant mapping. Replaces five hand-rolled per-file copies
 * (OrdersScreen, AdminOrders, AdminOrderDetail, StaffDashboard, useOfflineSync)
 * and the stale lowercase ORDER_STATUSES constant.
 */

/**
 * Active fulfilment progression, earliest → latest. Cancelled / Failed are
 * terminal and off-flow (not in this array). Used for offline-replay guards,
 * rolled-up multi-cycle status, and kitchen aggregation ordering.
 */
export const ORDER_STATUS_FLOW = [
  'Pending', 'Confirmed', 'Preparing', 'Ready', 'Packed',
  'Dispatched', 'Received at Hub', 'On the Way', 'Delivered',
] as const;

export type OrderStatusVariant = 'success' | 'warning' | 'info' | 'error';

/** Status → badge variant — used by every order-list / order-detail surface. */
export const ORDER_STATUS_VARIANT: Record<string, OrderStatusVariant> = {
  Pending: 'warning',
  Confirmed: 'info',
  Preparing: 'info',
  Ready: 'info',
  Packed: 'info',
  Dispatched: 'warning',
  'Received at Hub': 'info',
  'On the Way': 'warning',
  Delivered: 'success',
  Cancelled: 'error',
  Failed: 'error',
};

/** Badge variant for a status — defaults to 'info' for anything unmapped. */
export function orderStatusVariant(status: string | null | undefined): OrderStatusVariant {
  return ORDER_STATUS_VARIANT[status ?? ''] ?? 'info';
}
