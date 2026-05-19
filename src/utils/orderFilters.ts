/**
 * 1stOne F1 — Order filter helpers.
 *
 * Small pure predicates used by staff/hub/admin views to decide which
 * orders are operationally relevant (vs. revenue-record-only purchase
 * orders).
 */

import type { Order, OrderItem } from '../types';

/**
 * BF-31: a subscription PURCHASE order has every order_item.item_type
 * === 'subscription' (the plan line, not real food/essential items).
 * It belongs on the customer's My Orders history but must NOT surface
 * in staff Packing / Hub Dash because there's no physical delivery
 * tied to it.
 *
 * An "operational" order has at least one item_type ∈ {food, essential}
 * — i.e. something the kitchen / packing / driver / hub actually handles.
 * Sub-generated daily dispatch rows have item_type='food' / 'essential'
 * (copied from plan_items by generate_daily_manifest), so they pass.
 */
export function isOperationalOrder(
  order: Order & { order_items?: Pick<OrderItem, 'item_type'>[] | null }
): boolean {
  const items = order.order_items ?? [];
  return items.some(
    (oi) => oi.item_type === 'food' || oi.item_type === 'essential'
  );
}

/** Order statuses that mean the order is finished — no longer "in flight". */
const TERMINAL_STATUSES = new Set(['Delivered', 'Cancelled', 'Failed']);

/**
 * D2: an order is an "unsuccessful delivery" when its dispatch date is
 * already in the past (IST) and it still isn't Delivered / Cancelled /
 * Failed — a perishable order left undelivered.
 *
 * The batch board hides an order once the next cycle pushes; an
 * unsuccessful-delivery order must NOT vanish — staff / hub / driver /
 * admin keep it visible, flagged yellow, so it gets resolved.
 */
export function isUnsuccessfulDelivery(
  order: { dispatch_date?: string | null; status?: string | null },
): boolean {
  if (!order.dispatch_date) return false;
  if (TERMINAL_STATUSES.has(order.status ?? '')) return false;
  // IST calendar date — same basis as dispatch_date (a 'YYYY-MM-DD' string).
  const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return order.dispatch_date < todayIST;
}
