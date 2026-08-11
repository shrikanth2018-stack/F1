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
  /** Which door this row goes to. Part of what makes an arrival an arrival. */
  delivery_address_id?: number | null;
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
  /** Null only for a plan purchase, which is delivered nowhere. */
  addressId: number | null;
  totalAmount: number;
  createdAt: string;
}

/**
 * TWO HONEST READINGS OF "ONE DELIVERY", and both are needed.
 *
 * 'purchase' — same checkout, same window, same day. What My Orders and the
 *   order detail page show, because there a card is a thing you BOUGHT: it
 *   has one total, one payment and one cancel button. Merging two purchases
 *   would produce a card that cannot be cancelled as a unit.
 *
 * 'arrival'  — same window, same day, SAME ADDRESS, whoever bought what. What
 *   the home rail shows, because there the question is "what is coming and
 *   when", and two purchases landing at one door in one window are ONE trip.
 *   Splitting them told the customer they had two 7:30am deliveries when they
 *   had one.
 *
 *   THE ADDRESS IS NOT OPTIONAL HERE. Without it this merged a hub delivery to
 *   Home with a direct delivery to another address into a single row that then
 *   showed two conflicting statuses — "Received at Hub" and "On the Way" — for
 *   what it claimed was one arrival. Two doors, two journeys, two rows. The
 *   contradictory statuses were the symptom; the missing address was the
 *   cause.
 *
 * Named on purpose rather than left to each screen to spell out, so the
 * difference is a decision recorded in one place instead of a divergence
 * nobody meant.
 */
export type DeliveryGrouping = 'purchase' | 'arrival';

/**
 * The grouping key. A plan PURCHASE has no window and delivers nothing, so it
 * always stands alone under its own id rather than being merged with whatever
 * else shared its checkout — or, under 'arrival', with an unrelated purchase.
 */
export function deliveryKeyOf(row: DeliveryRow, by: DeliveryGrouping = 'purchase'): string {
  if (row.cycle_id == null) return `purchase-${row.id}`;
  if (by === 'arrival') {
    return `${row.cycle_id}:${row.dispatch_date}:${row.delivery_address_id ?? 'none'}`;
  }
  return `${row.order_group_id ?? `single-${row.id}`}:${row.cycle_id}:${row.dispatch_date}`;
}

export interface GroupOptions {
  /**
   * Drop the daily deliveries a subscription generates. True for My Orders,
   * where thirty of them a month would bury the orders the customer actually
   * placed; false for the order detail page, which must still open one.
   */
  excludeSubscriptionDispatches?: boolean;
  /** See DeliveryGrouping. Defaults to 'purchase'. */
  by?: DeliveryGrouping;
}

/** Group rows into deliveries, newest checkout first. */
export function groupIntoDeliveries<T extends DeliveryRow>(
  rows: T[],
  options: GroupOptions = {},
): Delivery<T>[] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    if (options.excludeSubscriptionDispatches && row.subscription_id != null) continue;
    const key = deliveryKeyOf(row, options.by ?? 'purchase');
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
      addressId: sorted[0].delivery_address_id ?? null,
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

/**
 * Soonest arrival first — the order the customer actually cares about on the
 * home rail.
 *
 * THE TIME OF DAY IS PART OF THE ANSWER. Sorting on `dispatch_date` alone
 * leaves Breakfast (07:30) and Dinner (19:30) on the same day tied, and a tie
 * falls back to whatever order the rows happened to arrive in — so tonight's
 * dinner could sit above tomorrow morning's breakfast, or not, unpredictably.
 * The cycle's delivery_start breaks it.
 *
 * A cycle with no known start sorts LAST within its day rather than first: an
 * unknown time is not evidence of urgency, and putting it at the top would
 * displace something we do know is imminent.
 */
export function sortBySoonestArrival<T>(
  deliveries: Delivery<T>[],
  cycleStarts: Record<number, string | null | undefined>,
): Delivery<T>[] {
  const minutes = (cycleId: number | null): number => {
    const raw = cycleId != null ? cycleStarts[cycleId] : null;
    if (!raw) return 24 * 60 + 1;
    const [h, m] = String(raw).split(':').map(Number);
    if (Number.isNaN(h)) return 24 * 60 + 1;
    return h * 60 + (Number.isNaN(m) ? 0 : m);
  };
  return [...deliveries].sort((a, b) => {
    const da = a.dispatchDate ?? '';
    const db = b.dispatchDate ?? '';
    if (da !== db) return da < db ? -1 : 1;
    const ma = minutes(a.cycleId);
    const mb = minutes(b.cycleId);
    if (ma !== mb) return ma - mb;
    return a.primaryId - b.primaryId;
  });
}

/**
 * The purchases inside one arrival, each with its own row ids.
 *
 * An arrival can hold two separate checkouts. They travel together and arrive
 * together, which is why the rail groups them — but they remain two purchases
 * with two detail pages and two cancel buttons, so anything TAPPABLE has to
 * address one of them, not the pair. This splits an arrival back into the
 * things a tap can legitimately open.
 */
export function purchasesWithin<T extends DeliveryRow>(delivery: Delivery<T>): Delivery<T>[] {
  return groupIntoDeliveries(delivery.rows, { by: 'purchase' });
}
