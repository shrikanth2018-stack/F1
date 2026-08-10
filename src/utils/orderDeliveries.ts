/**
 * 1stOne F1 — what the customer calls "an order".
 *
 * A DELIVERY IS THE UNIT, NOT AN `orders` ROW AND NOT A CHECKOUT.
 *
 * One checkout writes a row per (cycle, type): breakfast tomorrow and dinner
 * tonight are two rows because they go out at different times, and idli and
 * milk in the same morning are two rows because one is cooked and one comes
 * off a shelf. Only the second pair arrives together, in one bag, at one
 * door.
 *
 * So rows belong to the same delivery when they share the purchase, the
 * window AND the day. That is the object the customer is actually waiting
 * for, and the one the printed slip, the packer and the driver all handle as
 * a unit.
 *
 * This lived inline in three screens with the key spelled out each time.
 * Defining it once is what stops My Orders, the home rail and the order
 * detail page from quietly disagreeing about what one order is.
 */

import { ORDER_STATUS_FLOW } from './orderStatus';

/** The minimum a row needs to be grouped. */
export interface DeliveryRow {
  id: number;
  order_group_id?: string | null;
  cycle_id?: number | null;
  dispatch_date?: string | null;
  status?: string | null;
  created_at?: string | null;
  total_amount?: number | string | null;
  subscription_id?: number | null;
}

export interface Delivery<T> {
  /** Unique per delivery — safe as a React list key. */
  key: string;
  /** Every row id in this delivery, ascending. All are real, lookupable numbers. */
  ids: number[];
  /** Lowest id — what a deep link, a cancel or a review targets. */
  primaryId: number;
  rows: T[];
  cycleId: number | null;
  dispatchDate: string | null;
  totalAmount: number;
  createdAt: string;
}

/**
 * The grouping key. A plan PURCHASE has no window and delivers nothing, so it
 * stands alone under its own id rather than being merged with whatever else
 * shared its checkout.
 */
export function deliveryKeyOf(row: DeliveryRow): string {
  if (row.cycle_id == null) return `purchase-${row.id}`;
  return `${row.order_group_id ?? `single-${row.id}`}:${row.cycle_id}:${row.dispatch_date}`;
}

export interface GroupOptions {
  /**
   * Drop the daily deliveries a subscription generates. True for My Orders,
   * where thirty of them a month would bury the orders the customer actually
   * placed; false for the order detail page, which must still open one.
   */
  excludeSubscriptionDispatches?: boolean;
}

/** Group rows into deliveries, newest checkout first. */
export function groupIntoDeliveries<T extends DeliveryRow>(
  rows: T[],
  options: GroupOptions = {},
): Delivery<T>[] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    if (options.excludeSubscriptionDispatches && row.subscription_id != null) continue;
    const key = deliveryKeyOf(row);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }

  const out: Delivery<T>[] = [];
  map.forEach((group, key) => {
    const sorted = [...group].sort((a, b) => a.id - b.id);
    out.push({
      // The DELIVERY key, not the checkout's. Keying on order_group_id put
      // two cards from a two-cycle checkout under one React key.
      key,
      ids: sorted.map((r) => r.id),
      primaryId: sorted[0].id,
      rows: sorted,
      cycleId: sorted[0].cycle_id ?? null,
      dispatchDate: sorted[0].dispatch_date ?? null,
      totalAmount: sorted.reduce((s, r) => s + (Number(r.total_amount) || 0), 0),
      createdAt: sorted[0].created_at ?? '',
    });
  });

  // Newest checkout first; within a checkout, soonest delivery first.
  out.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return (a.dispatchDate ?? '') < (b.dispatchDate ?? '') ? -1 : 1;
  });
  return out;
}

/**
 * ONE status for a delivery made of several rows — the LEAST advanced of the
 * ones still running.
 *
 * A bag of idli and milk is two rows on different journeys: the food goes
 * through the kitchen, the milk is picked off a shelf and is "Packed" while
 * the food is still cooking. The customer is waiting for the whole bag, so
 * the tracker has to follow the slower half. Reporting the further-along row
 * would promise a bag that is not ready.
 *
 * Every row cancelled → Cancelled. A row cancelled on its own is ignored, so
 * one cancelled line cannot make a live delivery look dead.
 */
export function rolledUpStatus(rows: Array<{ status?: string | null }>): string {
  const active = rows.filter((r) => r.status !== 'Cancelled');
  if (active.length === 0) return 'Cancelled';
  return active.reduce<string>((least, r) => {
    const li = ORDER_STATUS_FLOW.indexOf(least as typeof ORDER_STATUS_FLOW[number]);
    const ri = ORDER_STATUS_FLOW.indexOf((r.status ?? '') as typeof ORDER_STATUS_FLOW[number]);
    return ri !== -1 && (li === -1 || ri < li) ? (r.status as string) : least;
  }, active[0].status ?? '');
}

/**
 * The delivery's order numbers, as the customer should quote them: "#11583,
 * #11584".
 *
 * EVERY NUMBER, not just the lowest. Each row id is real — staff search by
 * it, the driver reads it, it is printed on the slip — so showing only the
 * first left the customer unable to ask about the other half of their own
 * bag. Capped so a long checkout cannot push a title off the screen.
 */
export function formatOrderNumbers(ids: number[], max = 3): string {
  if (ids.length === 0) return '';
  if (ids.length <= max) return ids.map((id) => `#${id}`).join(', ');
  return `${ids.slice(0, max).map((id) => `#${id}`).join(', ')} +${ids.length - max}`;
}
