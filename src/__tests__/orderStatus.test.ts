/**
 * Tests for src/utils/orderStatus.ts — the single status vocabulary.
 *
 * THE ORDER OF `ORDER_STATUS_FLOW` IS LOAD-BEARING, not documentation.
 * `useOfflineSync` uses the array index to decide whether a queued status
 * update may still apply: it constrains the UPDATE to statuses EARLIER in this
 * array than the target, so a change that sat in a phone's offline queue can
 * never drag an order backwards after someone else advanced it. Reorder this
 * array and that guard silently starts allowing regressions.
 *
 * The same array feeds `rolledUpStatus`, which reports the LEAST advanced row
 * of a multi-row delivery — the tracker has to follow the slower half of a bag.
 */

import { ORDER_STATUS_FLOW, orderStatusVariant } from '../utils/orderStatus';

describe('ORDER_STATUS_FLOW', () => {
  it('is the fulfilment progression in order, earliest first', () => {
    expect([...ORDER_STATUS_FLOW]).toEqual([
      'Pending', 'Confirmed', 'Preparing', 'Ready', 'Packed',
      'Dispatched', 'Received at Hub', 'On the Way', 'Delivered',
    ]);
  });

  it('excludes the terminal off-flow statuses', () => {
    // Cancelled and Failed are reachable from anywhere and are never "later
    // than" anything. Putting them in the array would make the offline-replay
    // guard treat them as a position in the progression.
    expect(ORDER_STATUS_FLOW).not.toContain('Cancelled');
    expect(ORDER_STATUS_FLOW).not.toContain('Failed');
  });

  it('orders the hub leg after dispatch and before delivery', () => {
    const i = (s: string) => ORDER_STATUS_FLOW.indexOf(s as typeof ORDER_STATUS_FLOW[number]);
    expect(i('Dispatched')).toBeLessThan(i('Received at Hub'));
    expect(i('Received at Hub')).toBeLessThan(i('On the Way'));
    expect(i('On the Way')).toBeLessThan(i('Delivered'));
  });

  it('puts Ready after Preparing, which is what the kitchen advances through', () => {
    const i = (s: string) => ORDER_STATUS_FLOW.indexOf(s as typeof ORDER_STATUS_FLOW[number]);
    expect(i('Confirmed')).toBeLessThan(i('Preparing'));
    expect(i('Preparing')).toBeLessThan(i('Ready'));
    expect(i('Ready')).toBeLessThan(i('Packed'));
  });

  it('has no duplicates — an index must be unambiguous', () => {
    expect(new Set(ORDER_STATUS_FLOW).size).toBe(ORDER_STATUS_FLOW.length);
  });

  it('Delivered is the last position, so nothing can advance past it', () => {
    expect(ORDER_STATUS_FLOW[ORDER_STATUS_FLOW.length - 1]).toBe('Delivered');
  });
});

describe('orderStatusVariant', () => {
  it('maps the terminal outcomes to success and error', () => {
    expect(orderStatusVariant('Delivered')).toBe('success');
    expect(orderStatusVariant('Cancelled')).toBe('error');
    expect(orderStatusVariant('Failed')).toBe('error');
  });

  it('marks the states that are waiting on someone as warning', () => {
    expect(orderStatusVariant('Pending')).toBe('warning');      // customer hasn't paid
    expect(orderStatusVariant('Dispatched')).toBe('warning');   // out with a driver
    expect(orderStatusVariant('On the Way')).toBe('warning');
  });

  it('defaults to info for an unknown or missing status', () => {
    // A new status added in SQL but not here must not crash a badge.
    expect(orderStatusVariant('Something New')).toBe('info');
    expect(orderStatusVariant(null)).toBe('info');
    expect(orderStatusVariant(undefined)).toBe('info');
    expect(orderStatusVariant('')).toBe('info');
  });

  it('gives every status in the flow a variant', () => {
    for (const status of ORDER_STATUS_FLOW) {
      expect(['success', 'warning', 'info', 'error']).toContain(orderStatusVariant(status));
    }
  });
});
