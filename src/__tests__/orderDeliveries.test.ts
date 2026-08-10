/**
 * 1stOne F1 — "what is one delivery" — the definition My Orders, the order
 * detail page and the home rail all read from.
 */

import {
  deliveryKeyOf,
  groupIntoDeliveries,
  sortBySoonestArrival,
  purchasesWithin,
  rolledUpStatus,
  formatOrderNumbers,
  type DeliveryRow,
} from '../utils/orderDeliveries';

const row = (o: Partial<DeliveryRow> & { id: number }): DeliveryRow => ({
  order_group_id: 'grp-1',
  cycle_id: 1,
  dispatch_date: '2026-08-11',
  status: 'Confirmed',
  created_at: '2026-08-10T04:00:00Z',
  total_amount: 100,
  subscription_id: null,
  ...o,
});

describe('groupIntoDeliveries', () => {
  it('merges rows sharing purchase, window and day into ONE delivery', () => {
    // The case that prompted this: a food row and an essentials row in the
    // same morning bag were showing as two orders with two trackers.
    const out = groupIntoDeliveries([row({ id: 11583 }), row({ id: 11584 })]);
    expect(out).toHaveLength(1);
    expect(out[0].ids).toEqual([11583, 11584]);
    expect(out[0].primaryId).toBe(11583);
    expect(out[0].totalAmount).toBe(200);
  });

  it('keeps different windows apart, even in one checkout', () => {
    const out = groupIntoDeliveries([
      row({ id: 1, cycle_id: 1 }),
      row({ id: 2, cycle_id: 4 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps different days apart, even in the same window', () => {
    const out = groupIntoDeliveries([
      row({ id: 1, dispatch_date: '2026-08-11' }),
      row({ id: 2, dispatch_date: '2026-08-12' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('gives every delivery a DISTINCT key', () => {
    // The regression: the key was the checkout's order_group_id, so a
    // two-cycle checkout produced two cards under one React key.
    const out = groupIntoDeliveries([
      row({ id: 1, cycle_id: 1 }),
      row({ id: 2, cycle_id: 4 }),
    ]);
    expect(new Set(out.map((d) => d.key)).size).toBe(2);
  });

  it('never merges two customers who happen to lack a group id', () => {
    const out = groupIntoDeliveries([
      row({ id: 1, order_group_id: null }),
      row({ id: 2, order_group_id: null }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('stands a plan purchase on its own — it has no window', () => {
    const out = groupIntoDeliveries([
      row({ id: 1, cycle_id: null, dispatch_date: '2026-08-10' }),
      row({ id: 2, cycle_id: 1 }),
    ]);
    expect(out).toHaveLength(2);
    expect(deliveryKeyOf(row({ id: 1, cycle_id: null }))).toBe('purchase-1');
  });

  it('drops subscription dispatches only when asked', () => {
    // A dispatch row is created by generate_daily_manifest and gets its own
    // order_group_id from the column default — it never shares a checkout
    // with an order the customer placed, so it is its own delivery.
    const rows = [
      row({ id: 1, order_group_id: 'grp-1' }),
      row({ id: 2, order_group_id: 'grp-sub', subscription_id: 77 }),
    ];
    expect(groupIntoDeliveries(rows)).toHaveLength(2);
    expect(groupIntoDeliveries(rows, { excludeSubscriptionDispatches: true })).toHaveLength(1);
  });

  it('orders newest checkout first', () => {
    const out = groupIntoDeliveries([
      row({ id: 1, order_group_id: 'a', created_at: '2026-08-01T00:00:00Z' }),
      row({ id: 2, order_group_id: 'b', created_at: '2026-08-09T00:00:00Z' }),
    ]);
    expect(out.map((d) => d.primaryId)).toEqual([2, 1]);
  });

  it('is empty for no rows', () => {
    expect(groupIntoDeliveries([])).toEqual([]);
  });
});

describe('rolledUpStatus', () => {
  it('follows the SLOWER half of the bag', () => {
    // Milk is packed off a shelf while the idli is still being cooked. The
    // customer is waiting for the bag, not the faster half of it.
    expect(rolledUpStatus([{ status: 'Packed' }, { status: 'Confirmed' }])).toBe('Confirmed');
  });

  it('ignores a row cancelled on its own', () => {
    expect(rolledUpStatus([{ status: 'Cancelled' }, { status: 'Ready' }])).toBe('Ready');
  });

  it('is Cancelled only when everything is', () => {
    expect(rolledUpStatus([{ status: 'Cancelled' }, { status: 'Cancelled' }])).toBe('Cancelled');
  });

  it('reports Delivered when the whole bag is delivered', () => {
    expect(rolledUpStatus([{ status: 'Delivered' }, { status: 'Delivered' }])).toBe('Delivered');
  });

  it('does not let an unknown status win', () => {
    // An off-flow value must not be treated as "earliest" and stall the bar.
    expect(rolledUpStatus([{ status: 'Ready' }, { status: 'Wat' }])).toBe('Ready');
  });
});

describe('formatOrderNumbers', () => {
  it('shows every number in a normal bag', () => {
    expect(formatOrderNumbers([11583, 11584])).toBe('#11583, #11584');
  });

  it('caps a long list so a title cannot overflow', () => {
    expect(formatOrderNumbers([1, 2, 3, 4, 5])).toBe('#1, #2, #3 +2');
  });

  it('is empty for nothing', () => {
    expect(formatOrderNumbers([])).toBe('');
  });
});

describe("grouping by ARRIVAL (the home rail)", () => {
  it('clubs two separate purchases landing in the same window', () => {
    // The live case: #11581 (milk, one checkout) and #11605 (idli, another)
    // both arrive Breakfast 11 Aug. The rail was showing two 7:30am
    // deliveries to a customer who had one trip to the door.
    const rows = [
      row({ id: 11581, order_group_id: '7bf7368f' }),
      row({ id: 11605, order_group_id: '4bef67a0' }),
    ];
    expect(groupIntoDeliveries(rows, { by: 'arrival' })).toHaveLength(1);
    // ...while My Orders still sees them as the two purchases they are.
    expect(groupIntoDeliveries(rows, { by: 'purchase' })).toHaveLength(2);
  });

  it('still keeps different windows apart', () => {
    const out = groupIntoDeliveries([
      row({ id: 1, cycle_id: 1, order_group_id: 'a' }),
      row({ id: 2, cycle_id: 4, order_group_id: 'b' }),
    ], { by: 'arrival' });
    expect(out).toHaveLength(2);
  });

  it('never merges unrelated plan purchases', () => {
    const out = groupIntoDeliveries([
      row({ id: 1, cycle_id: null, order_group_id: 'a' }),
      row({ id: 2, cycle_id: null, order_group_id: 'b' }),
    ], { by: 'arrival' });
    expect(out).toHaveLength(2);
  });

  it('splits an arrival back into the purchases a tap can open', () => {
    const arrival = groupIntoDeliveries([
      row({ id: 11581, order_group_id: '7bf7368f' }),
      row({ id: 11605, order_group_id: '4bef67a0' }),
    ], { by: 'arrival' })[0];
    const purchases = purchasesWithin(arrival);
    expect(purchases).toHaveLength(2);
    expect(purchases.map((p) => p.primaryId).sort()).toEqual([11581, 11605]);
  });
});

describe('sortBySoonestArrival', () => {
  const STARTS = { 1: '07:30:00', 3: '16:30:00', 4: '19:30:00' };

  it('orders by TIME within a day, not just by date', () => {
    // The bug: dispatch_date alone tied Breakfast and Dinner on one day, and
    // the tie fell to whatever order the rows arrived in.
    const out = sortBySoonestArrival(
      groupIntoDeliveries([
        row({ id: 2, cycle_id: 4, order_group_id: 'b' }),
        row({ id: 1, cycle_id: 1, order_group_id: 'a' }),
      ], { by: 'arrival' }),
      STARTS,
    );
    expect(out.map((d) => d.cycleId)).toEqual([1, 4]);
  });

  it('puts an earlier DAY first regardless of time of day', () => {
    const out = sortBySoonestArrival(
      groupIntoDeliveries([
        row({ id: 1, cycle_id: 1, dispatch_date: '2026-08-12', order_group_id: 'a' }),
        row({ id: 2, cycle_id: 4, dispatch_date: '2026-08-11', order_group_id: 'b' }),
      ], { by: 'arrival' }),
      STARTS,
    );
    expect(out.map((d) => d.dispatchDate)).toEqual(['2026-08-11', '2026-08-12']);
  });

  it('sorts an unknown cycle time LAST within its day, not first', () => {
    // An unknown time is not evidence of urgency; putting it on top would
    // displace something we know is imminent.
    const out = sortBySoonestArrival(
      groupIntoDeliveries([
        row({ id: 1, cycle_id: 99, order_group_id: 'a' }),
        row({ id: 2, cycle_id: 4, order_group_id: 'b' }),
      ], { by: 'arrival' }),
      STARTS,
    );
    expect(out.map((d) => d.cycleId)).toEqual([4, 99]);
  });

  it('is stable and total — equal date and time fall back to id', () => {
    const out = sortBySoonestArrival(
      groupIntoDeliveries([
        row({ id: 9, cycle_id: 1, order_group_id: 'a' }),
        row({ id: 3, cycle_id: 1, dispatch_date: '2026-08-11', order_group_id: 'b' }),
      ], { by: 'purchase' }),
      STARTS,
    );
    expect(out.map((d) => d.primaryId)).toEqual([3, 9]);
  });
});
