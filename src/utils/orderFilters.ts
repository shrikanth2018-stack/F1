/**
 * 1stOne F1 — Order filter helpers.
 *
 * Small pure predicates used by staff/hub/admin views to decide which
 * orders are operationally relevant (vs. revenue-record-only purchase
 * orders).
 */

import type { Order, OrderItem } from '../types';
import { todayIST, istMinutesNow } from './istDate';
import { timeToMinutes } from './timeEngine';

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
  return order.dispatch_date < todayIST();
}

/** Delivery-window start per cycle id, from useDeliveryCycles. */
export type CycleStarts = Record<number, string | null | undefined>;

/**
 * Has this order's delivery moment passed while it is still unfinished?
 *
 * `isUnsuccessfulDelivery` above answers a coarser question — "is it from a
 * PREVIOUS day" — and is what the badges on four screens read. It is
 * deliberately left alone: it needs no cycle data, and every one of those
 * call sites has none.
 *
 * This is the finer question, and it is the one staff visibility depends on.
 * The board shows exactly one cycle's batch, and D2 carried over only
 * past-DATED orders — so an order from an EARLIER CYCLE OF THE SAME DAY that
 * had not finished fell through both and vanished until midnight. Confirmed
 * live: order 11496, Breakfast, due 07:30, still Confirmed at 11:43, visible
 * on no staff screen at all because the Lunch push had flipped the batch.
 *
 * "Its cycle has started" is the right test rather than "a later cycle
 * pushed": it is true for exactly the orders somebody should already be
 * acting on, and false for this evening's dinner, which has not come due and
 * would only clutter the board.
 */
export function isPastDue(
  order: { dispatch_date?: string | null; status?: string | null; cycle_id?: number | null },
  cycleStarts: CycleStarts,
): boolean {
  if (!order.dispatch_date) return false;
  if (TERMINAL_STATUSES.has(order.status ?? '')) return false;

  const today = todayIST();
  if (order.dispatch_date < today) return true;
  if (order.dispatch_date > today) return false;

  // Today: due once the cycle's delivery window has opened.
  //
  // AN UNKNOWN CYCLE COUNTS AS DUE. `useDeliveryCycles` returns only ACTIVE
  // cycles, so an order sitting on a cycle an admin has since switched off
  // has no entry here — and hiding it would be the very failure this
  // function exists to prevent, on the orders least likely to be noticed.
  // Showing one early is clutter; hiding one that is due loses somebody's
  // food. The asymmetry decides it.
  const start = order.cycle_id != null ? cycleStarts[order.cycle_id] : null;
  if (!start) return true;
  return timeToMinutes(start) <= istMinutesNow();
}
