/**
 * Tests for the BF-31 sub-purchase exclusion predicate.
 *
 * isOperationalOrder is the gate that decides whether an order belongs in
 * staff Kitchen / Packing / Hub Dash views vs. customer-only My Orders.
 * Locks in the behavior that prevents subscription-PURCHASE orders (rows
 * whose only items are item_type='subscription') from leaking into staff
 * lists.
 */

import { isOperationalOrder } from '@/utils/orderFilters';
import type { Order } from '@/types';

function makeOrder(overrides: {
  itemTypes?: string[];
  status?: string;
  order_type?: string;
}): Order & { order_items: any[] } {
  return {
    id: 1,
    user_id: 'u1',
    total_amount: 0,
    status: (overrides.status ?? 'Confirmed') as any,
    order_type: (overrides.order_type ?? 'food') as any,
    payment_method: 'wallet',
    dispatch_date: '2026-05-12',
    created_at: '2026-05-11T00:00:00Z',
    updated_at: '2026-05-11T00:00:00Z',
    cycle_id: 1,
    delivery_method: 'direct',
    delivery_address_id: null,
    hub_id: null,
    razorpay_order_id: null,
    razorpay_payment_id: null,
    notes: null,
    tax_amount: 0,
    delivery_fee: 0,
    wallet_amount_used: 0,
    subscription_id: null,
    paid_at: null,
    branch_id: 1,
    order_items: (overrides.itemTypes ?? []).map((t, idx) => ({
      id: idx + 1,
      order_id: 1,
      item_id: idx + 1,
      item_name: `item-${idx}`,
      item_type: t,
      quantity: 1,
      price_at_time: 0,
    })),
  } as any;
}

describe('isOperationalOrder', () => {
  it('returns true for a pure food order', () => {
    expect(isOperationalOrder(makeOrder({ itemTypes: ['food'] }))).toBe(true);
  });

  it('returns true for a pure essentials order', () => {
    expect(isOperationalOrder(makeOrder({ itemTypes: ['essential'] }))).toBe(true);
  });

  it('returns true for a mixed cart (food + subscription)', () => {
    expect(
      isOperationalOrder(makeOrder({ itemTypes: ['subscription', 'food'] })),
    ).toBe(true);
  });

  it('returns true for a mixed cart (essential + subscription)', () => {
    expect(
      isOperationalOrder(makeOrder({ itemTypes: ['subscription', 'essential'] })),
    ).toBe(true);
  });

  // ── Regression guards (BF-31) ─────────────────────────────

  it('regression BF-31: excludes a subscription-only purchase order', () => {
    // place-order's order_items for a sub-only buy contains a single row
    // with item_type='subscription'. This must NOT surface in staff views.
    expect(isOperationalOrder(makeOrder({ itemTypes: ['subscription'] }))).toBe(false);
  });

  it('regression BF-31: excludes multiple-plan purchase (all subscription items)', () => {
    expect(
      isOperationalOrder(makeOrder({ itemTypes: ['subscription', 'subscription'] })),
    ).toBe(false);
  });

  // ── Defensive cases ──────────────────────────────────────

  it('returns false for an order with no items array (defensive)', () => {
    const o = { id: 1 } as any;
    expect(isOperationalOrder(o)).toBe(false);
  });

  it('returns false for an order with empty items array', () => {
    expect(isOperationalOrder(makeOrder({ itemTypes: [] }))).toBe(false);
  });

  it('returns false for unknown item_type values (forward-compat)', () => {
    // If a future item_type is added (e.g. 'gift_card'), it shouldn't auto-
    // surface in staff views — operators only see what they explicitly handle.
    expect(
      isOperationalOrder(makeOrder({ itemTypes: ['gift_card', 'subscription'] })),
    ).toBe(false);
  });
});

// ── isPastDue ────────────────────────────────────────────────
//
// The bug this guards: a board scoped to one cycle's batch, where the D2
// carry-over only rescued orders from a PREVIOUS day. An order from an
// earlier CYCLE of the same day matched neither and was invisible until
// midnight. Confirmed live on order 11496 — Breakfast, due 07:30, still
// Confirmed at 11:43, on no board at all.
//
// The STAFF board no longer carries anything over — it is exactly one batch,
// and unfinished work is picked up in Admin → Orders → Undelivered. The
// DRIVER board still uses this, which is why it stays.

import { isPastDue } from '../utils/orderFilters';
import { todayIST, istDateWithOffset } from '../utils/istDate';

const CYCLES = { 1: '07:30:00', 2: '12:30:00', 4: '19:30:00' };

describe('isPastDue', () => {
  const today = todayIST();

  it('rescues an unfinished order from an EARLIER cycle of today', () => {
    // Breakfast delivers at 07:30. Any test run happens after that only if
    // the clock says so, so assert against a cycle that has certainly opened.
    const openedCycle = { 1: '00:00:00' };
    expect(isPastDue({ dispatch_date: today, status: 'Confirmed', cycle_id: 1 }, openedCycle)).toBe(true);
  });

  it('does NOT show a cycle that has not come due yet', () => {
    // 23:59 has not opened at any hour a test can run.
    expect(isPastDue({ dispatch_date: today, status: 'Confirmed', cycle_id: 4 }, { 4: '23:59:00' })).toBe(false);
  });

  it('still rescues a past-DATED order, whatever its cycle', () => {
    expect(isPastDue({ dispatch_date: istDateWithOffset(-1), status: 'Confirmed', cycle_id: 4 }, CYCLES)).toBe(true);
  });

  it('ignores finished orders — delivered, cancelled and failed are done', () => {
    for (const status of ['Delivered', 'Cancelled', 'Failed']) {
      expect(isPastDue({ dispatch_date: istDateWithOffset(-1), status, cycle_id: 1 }, CYCLES)).toBe(false);
    }
  });

  it('never shows a FUTURE dispatch date', () => {
    expect(isPastDue({ dispatch_date: istDateWithOffset(1), status: 'Confirmed', cycle_id: 1 }, { 1: '00:00:00' })).toBe(false);
  });

  it('SHOWS rather than hides when the cycle is unknown', () => {
    // useDeliveryCycles returns only ACTIVE cycles, so an order on a cycle an
    // admin has since switched off has no entry — and hiding it would be the
    // exact failure this function exists to prevent, on the orders least
    // likely to be noticed. Showing one early is clutter; hiding one that is
    // due loses somebody's food.
    expect(isPastDue({ dispatch_date: today, status: 'Confirmed', cycle_id: 99 }, CYCLES)).toBe(true);
    expect(isPastDue({ dispatch_date: today, status: 'Confirmed', cycle_id: null }, CYCLES)).toBe(true);
  });
});
