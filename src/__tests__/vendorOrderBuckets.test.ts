/**
 * 1stOne F1 — vendor order bucketing + upcoming aggregation.
 *
 * The bucket itself is decided server-side (kitchen_push_log), so what is
 * tested here is the split and the shopping-list aggregation the Supply tab
 * renders from it — the two pieces that run on the device.
 */

import {
  splitVendorOrders,
  summariseUpcoming,
  type BucketableOrder,
} from '../utils/vendorOrderBuckets';

/** The shaping only reads these four fields; order_id rides along for assertions. */
type TestOrder = BucketableOrder & { order_id: number };

const order = (o: Partial<TestOrder> & { order_id: number }): TestOrder => ({
  dispatch_date: '2026-08-10',
  cycle_name: 'Morning',
  items: [],
  bucket: 'now',
  ...o,
});

describe('splitVendorOrders', () => {
  it('files each row under its server-assigned bucket', () => {
    const split = splitVendorOrders([
      order({ order_id: 1, bucket: 'now' }),
      order({ order_id: 2, bucket: 'upcoming' }),
      order({ order_id: 3, bucket: 'history' }),
      order({ order_id: 4, bucket: 'now' }),
    ]);
    expect(split.now.map((o) => o.order_id)).toEqual([1, 4]);
    expect(split.upcoming.map((o) => o.order_id)).toEqual([2]);
    expect(split.history.map((o) => o.order_id)).toEqual([3]);
  });

  it('reads history newest-first', () => {
    // The RPC returns oldest-first, which is right for work you are about to
    // do and wrong for a record of what already happened.
    const split = splitVendorOrders([
      order({ order_id: 1, bucket: 'history', dispatch_date: '2026-08-01' }),
      order({ order_id: 2, bucket: 'history', dispatch_date: '2026-08-05' }),
      order({ order_id: 3, bucket: 'history', dispatch_date: '2026-08-09' }),
    ]);
    expect(split.history.map((o) => o.order_id)).toEqual([3, 2, 1]);
  });

  it('treats a missing bucket as live', () => {
    // The column only exists once vendor_orders_batch_scope.sql is applied.
    // An app shipped ahead of that SQL must keep showing the vendor their
    // orders, not an empty screen.
    const legacy = { ...order({ order_id: 7 }) };
    delete (legacy as Partial<TestOrder>).bucket;
    const split = splitVendorOrders([legacy]);
    expect(split.now.map((o) => o.order_id)).toEqual([7]);
    expect(split.upcoming).toHaveLength(0);
    expect(split.history).toHaveLength(0);
  });

  it('returns three empty lists for an empty result', () => {
    const split = splitVendorOrders([]);
    expect(split).toEqual({ now: [], upcoming: [], history: [] });
  });
});

describe('summariseUpcoming', () => {
  it('adds quantities across orders in the same run', () => {
    // The whole point: a vendor buys six litres, not "three orders".
    const runs = summariseUpcoming([
      order({ order_id: 1, items: [{ item_name: 'Milk 1L', quantity: 2 }] }),
      order({ order_id: 2, items: [{ item_name: 'Milk 1L', quantity: 4 }] }),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].order_count).toBe(2);
    expect(runs[0].items).toEqual([{ item_name: 'Milk 1L', quantity: 6 }]);
  });

  it('keeps different runs apart, even on the same day', () => {
    const runs = summariseUpcoming([
      order({ order_id: 1, dispatch_date: '2026-08-11', cycle_name: 'Morning' }),
      order({ order_id: 2, dispatch_date: '2026-08-11', cycle_name: 'Evening' }),
    ]);
    expect(runs).toHaveLength(2);
  });

  it('sorts runs soonest-first', () => {
    const runs = summariseUpcoming([
      order({ order_id: 1, dispatch_date: '2026-08-13' }),
      order({ order_id: 2, dispatch_date: '2026-08-11' }),
      order({ order_id: 3, dispatch_date: '2026-08-12' }),
    ]);
    expect(runs.map((r) => r.dispatch_date)).toEqual([
      '2026-08-11', '2026-08-12', '2026-08-13',
    ]);
  });

  it('puts the bulk of the trip first within a run', () => {
    const runs = summariseUpcoming([
      order({
        order_id: 1,
        items: [
          { item_name: 'Curd 500g', quantity: 1 },
          { item_name: 'Milk 1L', quantity: 9 },
          { item_name: 'Ghee', quantity: 3 },
        ],
      }),
    ]);
    expect(runs[0].items.map((i) => i.item_name)).toEqual(['Milk 1L', 'Ghee', 'Curd 500g']);
  });

  it('survives an order with no lines', () => {
    const runs = summariseUpcoming([order({ order_id: 1, items: [] })]);
    expect(runs[0].order_count).toBe(1);
    expect(runs[0].items).toEqual([]);
  });

  it('does not mutate the orders it was given', () => {
    const lines = [{ item_name: 'Milk 1L', quantity: 2 }];
    const input = [order({ order_id: 1, items: lines })];
    summariseUpcoming(input);
    expect(lines).toEqual([{ item_name: 'Milk 1L', quantity: 2 }]);
  });
});
