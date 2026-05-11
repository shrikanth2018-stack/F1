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
