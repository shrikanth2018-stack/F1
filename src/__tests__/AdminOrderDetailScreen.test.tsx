/**
 * Smoke tests for the admin order detail — where an order is refunded and
 * where its status is forced.
 *
 * WHAT THEY GUARD:
 *   1. the payment SPLIT. A part-wallet, part-Razorpay order refunds by two
 *      different mechanisms — the wallet half is automatic, the Razorpay half
 *      is a human in the Razorpay dashboard. Showing the wrong split means
 *      refunding the wrong amount by hand.
 *   2. the advance button offers the ADMIN's next status, per delivery method
 *      — hub orders go via 'Received at Hub', direct ones do not.
 *   3. a past-dated undelivered order says "Cancel Order", not
 *      "Cancel + Refund" — there is nothing to refund on a delivery that
 *      never happened as ordered.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

let mockOrder: Record<string, unknown> | null = null;
jest.mock('@/api/useSupabaseQuery', () => ({
  useSupabaseSingle: () => ({
    data: mockOrder, isLoading: false, error: null, refetch: jest.fn(),
  }),
}));

jest.mock('@/hooks/useAdminOrders', () => ({
  useAdminCancelOrder: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/useStaffOrders', () => ({
  useUpdateOrderStatus: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

import { AdminOrderDetailScreen } from '@/screens/admin/AdminOrderDetailScreen';

const BASE = {
  id: 11480,
  status: 'Dispatched',
  order_type: 'food',
  delivery_method: 'hub',
  dispatch_date: '2999-01-01',      // far future: NOT an unsuccessful delivery
  total_amount: 500,
  wallet_amount_used: 200,          // so the Razorpay portion is 300
  tax_amount: 0,
  delivery_fee: 0,
  payment_method: 'razorpay',
  created_at: '2026-08-04T06:00:00Z',
  notes: null,
  cycle_id: 3,
  order_items: [{ id: 1, item_name: 'Chapati Roll', quantity: 2, price_at_time: 250, item_type: 'food' }],
  customer_addresses: { address_line: '1 Test Street', delivery_hubs: { hub_name: 'Hub A', driver_code: 'D1' } },
  profiles: { full_name: 'One Customer', phone_number: '919155555555' },
};

const open = (over: Record<string, unknown> = {}) => {
  mockOrder = { ...BASE, ...over };
  return render(
    <AdminOrderDetailScreen
      route={{ params: { orderId: 11480 } } as never}
      navigation={{ goBack: jest.fn(), navigate: jest.fn() } as never}
    />,
  );
};

beforeEach(() => jest.clearAllMocks());

describe('AdminOrderDetailScreen — the refund split', () => {
  it('splits a part-wallet order into its two refund routes', () => {
    open();
    expect(screen.getByText('₹500')).toBeTruthy();            // total
    expect(screen.getByText('Wallet portion')).toBeTruthy();
    expect(screen.getByText('₹200')).toBeTruthy();
    expect(screen.getByText('Razorpay portion')).toBeTruthy();
    expect(screen.getByText('₹300')).toBeTruthy();            // 500 - 200
  });

  it('shows no Razorpay portion on a fully-wallet order', () => {
    open({ wallet_amount_used: 500, payment_method: 'wallet' });
    expect(screen.getByText('Wallet portion')).toBeTruthy();
    expect(screen.queryByText('Razorpay portion')).toBeNull();
  });
});

describe('AdminOrderDetailScreen — status and cancellation', () => {
  it('offers the hub handoff as the next step for a hub order', () => {
    open({ status: 'Dispatched', delivery_method: 'hub' });
    expect(screen.getByText(/Received at Hub/)).toBeTruthy();
  });

  it('skips the hub for a direct order', () => {
    open({ status: 'Dispatched', delivery_method: 'direct' });
    expect(screen.queryByText(/Received at Hub/)).toBeNull();
    expect(screen.getByText(/On the Way/)).toBeTruthy();
  });

  it('offers Cancel + Refund on a live order', () => {
    open({ status: 'Confirmed' });
    expect(screen.getByText('Cancel + Refund')).toBeTruthy();
  });

  it('offers plain Cancel on a past-dated undelivered order', () => {
    // D2: dispatch date already gone and still not delivered. There is
    // nothing to refund against a delivery that never happened as ordered.
    open({ status: 'Dispatched', dispatch_date: '2020-01-01' });
    expect(screen.getByText('Cancel Order')).toBeTruthy();
    expect(screen.queryByText('Cancel + Refund')).toBeNull();
  });
});
