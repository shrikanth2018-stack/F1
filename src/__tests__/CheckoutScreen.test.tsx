/**
 * Smoke tests for Checkout — the screen where money leaves.
 *
 * WHAT THEY GUARD. Checkout's whole contract is that it DISPLAYS the server's
 * quote and never computes one. These lock that in:
 *   1. the totals shown are the server's numbers, rendered verbatim
 *   2. GST is shown as included, never added to the total
 *   3. Pay is unavailable until a quote exists
 *   4. Pay is unavailable when the wallet cannot cover it, and says by how much
 *   5. a disabled essentials module refuses the essentials cart outright
 *
 * They do NOT drive a real payment. Razorpay, place-order and confirm-order
 * are boundaries this screen calls; exercising them needs a real user token
 * and a real gateway, which is a device job, not a jest one.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from './_helpers/queryClient';

// ── Boundaries ───────────────────────────────────────────────
let mockQuote: unknown = null;
let mockQuoteState = { isLoading: false, isError: false, error: null as unknown };
let mockWallet = 5000;
let mockEssentialsEnabled = true;

jest.mock('@/hooks/useOrderQuote', () => ({
  useOrderQuote: () => ({
    data: mockQuote,
    isLoading: mockQuoteState.isLoading,
    isError: mockQuoteState.isError,
    error: mockQuoteState.error,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/hooks/useAddresses', () => ({
  useAddresses: () => ({
    data: [{ id: 2, label: 'Home', address_line: '1 Test Street', is_default: true, branch_id: 1 }],
  }),
}));

jest.mock('@/hooks/useWallet', () => ({
  useWalletBalance: () => ({ data: { balance: mockWallet } }),
}));

jest.mock('@/hooks/useSmartCart', () => ({ useSmartCart: () => ({ evaluations: [] }) }));
jest.mock('@/hooks/useEssentialsEnabled', () => ({
  useEssentialsEnabled: () => mockEssentialsEnabled,
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1', phone: '919155555555' } } }),
}));

// Zustand stores are read with selectors, so the mock has to accept one.
const mockCart: { items: any[]; plans: unknown[]; clearCart: jest.Mock; clearPlans: jest.Mock } = {
  items: [{ item_id: 1, item_type: 'food', cycle_id: 3, name: 'Chapati Roll', display_price: 50, quantity: 2 }] as any[],
  plans: [] as unknown[],
  clearCart: jest.fn(),
  clearPlans: jest.fn(),
};
jest.mock('@/store/cartStore', () => ({
  useCartStore: (sel: (s: unknown) => unknown) => sel(mockCart),
}));
jest.mock('@/store/uiStore', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ setGlobalLoading: jest.fn() }),
}));

jest.mock('@/utils/razorpay', () => ({ __esModule: true, default: { open: jest.fn() } }));
jest.mock('@/utils/analytics', () => ({
  trackOrderPlaced: jest.fn(), trackOrderFailed: jest.fn(), trackSubscribed: jest.fn(),
}));
jest.mock('@/utils/sentry', () => ({ captureError: jest.fn() }));
jest.mock('@/utils/confirmDialog', () => ({
  infoDialog: jest.fn(() => Promise.resolve()), confirmDialog: jest.fn(() => Promise.resolve(true)),
}));

import { CheckoutScreen } from '@/screens/customer/CheckoutScreen';

// Deliberately NOT round numbers, and deliberately not 100: the cart line is
// 2 x ₹50, so a ₹100 subtotal is indistinguishable from the line total and the
// test would pass on the wrong element.
const QUOTE = {
  subtotal_total: 137,
  delivery_fee: 23,
  grand_total: 160,
  tax_total: 7.62,
  total_paise: 16000,
  dispatches: [{ cycle_id: 3, dispatch_date: '2026-08-04', group_total_paise: 16000 }],
  has_scenario_c: false,
  storm_mode: false,
  serviceable: true,
  fee_pending: false,
  groups: [],
};

const open = () => {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CheckoutScreen navigation={{ navigate: jest.fn(), goBack: jest.fn(), popToTop: jest.fn() }} route={{ params: {} }} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQuote = QUOTE;
  mockQuoteState = { isLoading: false, isError: false, error: null };
  mockWallet = 5000;
  mockEssentialsEnabled = true;
  // The cart is mutated by the essentials-gate test, so reset it per test.
  mockCart.items = [
    { item_id: 1, item_type: 'food', cycle_id: 3, name: 'Chapati Roll', display_price: 50, quantity: 2 },
  ];
});

describe('CheckoutScreen — it displays the server’s quote, it does not compute one', () => {
  it('renders the server’s numbers verbatim', () => {
    open();
    expect(screen.getByText('₹137')).toBeTruthy();      // subtotal
    expect(screen.getByText('₹23')).toBeTruthy();       // delivery
    expect(screen.getAllByText('₹160').length).toBeGreaterThan(0); // total, and on Pay
  });

  it('shows GST as already included, never added on top', () => {
    open();
    // 100 + 20 = 120 with tax INSIDE it. If tax were ever added the total
    // would read 125.71, so this asserts the pricing model itself.
    expect(screen.getByText(/Incl\. GST/)).toBeTruthy();
    expect(screen.queryByText('₹167.62')).toBeNull();
  });

  it('will not let you pay before a quote exists', () => {
    mockQuote = null;
    mockQuoteState = { isLoading: true, isError: false, error: null };
    open();
    expect(screen.getByText(/Calculating total/)).toBeTruthy();
    // By ROLE: the two payment options are radios also labelled "Pay …",
    // so a label-only query matches three elements.
    const pay = screen.getByRole('button', { name: /Pay/ });
    expect(pay.props.accessibilityState.disabled).toBe(true);
  });

  it('blocks payment when the wallet cannot cover it, and says by how much', () => {
    mockWallet = 90;   // ₹70 short of ₹160
    const { getByText } = open();
    // The shortfall only surfaces once wallet is the chosen method — the
    // screen defaults to Razorpay.
    fireEvent.press(screen.getByRole('radio', { name: 'Pay from wallet' }));
    expect(getByText(/Need ₹70 more/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pay/ }).props.accessibilityState.disabled).toBe(true);
  });

  // With one cart the gate can no longer key off a route param — it has to
  // read what the cart actually holds.
  it('refuses checkout when the cart holds essentials and the module is off', () => {
    mockEssentialsEnabled = false;
    mockCart.items = [
      { item_id: 9, item_type: 'essential', cycle_id: 3, name: 'Milk 500ml', display_price: 26, quantity: 1 },
    ];
    const client = createTestQueryClient();
    render(
      <QueryClientProvider client={client}>
        <CheckoutScreen
          navigation={{ navigate: jest.fn(), goBack: jest.fn(), popToTop: jest.fn() }}
          route={{ params: {} }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Essentials checkout is currently unavailable/)).toBeTruthy();
  });
});
