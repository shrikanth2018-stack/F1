/**
 * 1stOne F1 — "what is one delivery" — the definition My Orders, the order
 * detail page and the home rail all read from.
 */

import {
  deliveryKeyOf,
  groupIntoDeliveries,
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
