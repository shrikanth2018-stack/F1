/**
 * 1stOne F1 — Vendor supply-list shaping.
 *
 * Pure. Lives here rather than beside the hook so it can be tested without
 * dragging in the Supabase client and the auth chain behind it.
 *
 * The BUCKET itself is not decided here — the server assigns it from
 * kitchen_push_log (supabase/sql/vendor_orders_batch_scope.sql), so the
 * vendor's idea of "now" is the same batch Kitchen, Packing, Driver and Hub
 * are looking at. What these functions do is arrange the result: split it
 * into the three sections, and turn the upcoming rows into a shopping list.
 */

/**
 * 'now'      — in the batch currently released; the only rows the vendor can
 *              act on.
 * 'upcoming' — not released to anyone yet. The vendor's lead time to buy.
 * 'history'  — finished, or its batch was superseded while unfinished (the
 *              same row admin chases in Orders → Undelivered).
 */
export type VendorOrderBucket = 'now' | 'upcoming' | 'history';

/** The minimum a row needs for the shaping below. */
export interface BucketableOrder {
  dispatch_date: string;
  cycle_name: string | null;
  items: { item_name: string; quantity: number }[];
  bucket: VendorOrderBucket;
}

/** The three sections, split once so the screen does not filter three times. */
export function splitVendorOrders<T extends BucketableOrder>(
  orders: T[],
): Record<VendorOrderBucket, T[]> {
  const out: Record<VendorOrderBucket, T[]> = { now: [], upcoming: [], history: [] };
  // A row from before the batch-scoping SQL was applied has no bucket at all.
  // Treating it as live keeps such an app showing the vendor their orders
  // rather than an empty screen.
  for (const o of orders) out[o.bucket ?? 'now'].push(o);
  // History reads newest-first — the opposite of work you are about to do.
  out.history.reverse();
  return out;
}

/** One upcoming delivery run, with everything the vendor has to bring to it. */
export interface UpcomingRun {
  key: string;
  dispatch_date: string;
  cycle_name: string | null;
  order_count: number;
  items: { item_name: string; quantity: number }[];
}

/**
 * Upcoming work, aggregated per delivery run rather than listed per order.
 *
 * A VENDOR BUYS BY QUANTITY, NOT BY ORDER. Six upcoming orders for one
 * Thursday morning is six rows to read and add up in your head; "Thursday
 * morning — Milk 1L ×6, Curd 500g ×2" is the shopping list. The per-order
 * detail still exists the moment the run is released, in the Now section,
 * which is where acting on an individual order belongs.
 *
 * Sorted soonest-first, and items within a run by descending quantity — the
 * bulk of the trip first. Copies every line it touches; the caller's rows are
 * React Query cache data and must not be mutated.
 */
export function summariseUpcoming(orders: BucketableOrder[]): UpcomingRun[] {
  const runs = new Map<string, UpcomingRun>();
  for (const o of orders) {
    const key = `${o.dispatch_date}:${o.cycle_name ?? ''}`;
    const run = runs.get(key) ?? {
      key,
      dispatch_date: o.dispatch_date,
      cycle_name: o.cycle_name,
      order_count: 0,
      items: [],
    };
    run.order_count += 1;
    for (const line of o.items ?? []) {
      const existing = run.items.find((i) => i.item_name === line.item_name);
      if (existing) existing.quantity += Number(line.quantity) || 0;
      else run.items.push({ item_name: line.item_name, quantity: Number(line.quantity) || 0 });
    }
    runs.set(key, run);
  }
  const out = [...runs.values()];
  for (const run of out) run.items.sort((a, b) => b.quantity - a.quantity);
  out.sort((a, b) => (a.dispatch_date < b.dispatch_date ? -1 : a.dispatch_date > b.dispatch_date ? 1 : 0));
  return out;
}
