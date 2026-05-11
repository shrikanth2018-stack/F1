/**
 * Tests for the customer order hooks — useCancelOrder + useConfirmOrder.
 * Both wrap Edge fn invokes; the hook contracts are what matters here.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

import { renderHook, act } from '@testing-library/react-native';
import { createWrapper } from './_helpers/queryClient';

const mockInvoke = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@/api/supabaseClient', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    auth: { getSession: () => mockGetSession() },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('@/api/invalidateOrderQueries', () => ({
  invalidateOrderQueries: jest.fn(),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    session: {
      user: { id: 'cust-1', phone: '915555555555' },
      role: 'customer',
      assignedHubId: null,
      branchId: 1,
      isDriver: false,
    },
    isLoading: false,
  }),
}));

import { useCancelOrder, useConfirmOrder } from '@/hooks/useOrders';

beforeEach(() => {
  mockInvoke.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'cust-token' } },
  });
});

// ── useCancelOrder ───────────────────────────────────────

describe('useCancelOrder', () => {
  it('invokes cancel-order Edge fn with order_id and bearer token', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { status: 'cancelled', wallet_refunded: 100, razorpay_refund_due: 0 },
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCancelOrder(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ order_id: 9442 });
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [fnName, opts] = mockInvoke.mock.calls[0];
    expect(fnName).toBe('cancel-order');
    expect(opts.body).toEqual({ order_id: 9442 });
    expect(opts.headers.Authorization).toBe('Bearer cust-token');
  });

  it('surfaces server error message from the Edge fn context body', async () => {
    // cancel-order returns 409 with JSON {error: "..."} in the response body
    // when the cancellation window has passed. The hook reads ctx.error.
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: {
        context: {
          error: 'Cancellation window of 2h has passed. Contact support for help.',
        },
      },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCancelOrder(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ order_id: 9442 })).rejects.toThrow(
        'Cancellation window of 2h has passed',
      );
    });
  });

  it('throws generic message when no error context is provided', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('network blip') });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCancelOrder(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ order_id: 9442 })).rejects.toThrow(
        'Cancellation failed',
      );
    });
  });

  it('throws when no session exists (anonymous caller defense)', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCancelOrder(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ order_id: 9442 })).rejects.toThrow(
        'Not authenticated',
      );
    });
  });
});

// ── useConfirmOrder ─────────────────────────────────────

describe('useConfirmOrder', () => {
  it('invokes confirm-order with Razorpay payload + bearer token', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { status: 'paid', subscriptions_activated: 0 },
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useConfirmOrder(), { wrapper: Wrapper });

    const payload = {
      order_id: 9442,
      razorpay_payment_id: 'pay_X',
      razorpay_order_id: 'order_X',
      razorpay_signature: 'sig_X',
    };

    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      'confirm-order',
      expect.objectContaining({
        body: payload,
        headers: expect.objectContaining({ Authorization: 'Bearer cust-token' }),
      }),
    );
  });
});
