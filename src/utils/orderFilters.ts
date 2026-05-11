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
