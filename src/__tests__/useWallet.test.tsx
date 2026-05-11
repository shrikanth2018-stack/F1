/**
 * Tests for useWallet hooks. Covers the BF-38a fix (F1.3) — wallet
 * topup invoke must include an Idempotency-Key header so a double-tap
 * or network retry doesn't create a second Razorpay order.
 */

import { renderHook, act } from '@testing-library/react-native';
import { createWrapper } from './_helpers/queryClient';

// ── Module mocks ─────────────────────────────────────────

const mockInvoke = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/api/supabaseClient', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getSession: jest.fn() },
  },
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    session: {
      user: { id: 'user-123', phone: '915555555555' },
      role: 'customer',
      assignedHubId: null,
      branchId: 1,
      isDriver: false,
    },
    isLoading: false,
  }),
}));

// useWalletTopup imported AFTER mocks are set up
import { useWalletTopup } from '@/hooks/useWallet';

beforeEach(() => {
  mockInvoke.mockReset();
  mockFrom.mockReset();
});

describe('useWalletTopup — BF-38a (F1.3)', () => {
  it('sends Idempotency-Key header on invoke', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { razorpay_order_id: 'order_test', amount: 500 },
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWalletTopup(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync(500);
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [fnName, opts] = mockInvoke.mock.calls[0];
    expect(fnName).toBe('wallet-topup');
    expect(opts.body).toEqual({ amount: 500 });
    expect(opts.headers).toBeDefined();
    expect(opts.headers['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('regression: two successive topup calls send DIFFERENT Idempotency-Keys', async () => {
    // Each topup is a logically-distinct intent. The same key would cause
    // the SECOND topup to silently return the first's cached response.
    mockInvoke.mockResolvedValue({
      data: { razorpay_order_id: 'order_test', amount: 500 },
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWalletTopup(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync(500);
      await result.current.mutateAsync(1000);
    });

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    const key1 = mockInvoke.mock.calls[0][1].headers['Idempotency-Key'];
    const key2 = mockInvoke.mock.calls[1][1].headers['Idempotency-Key'];
    expect(key1).not.toBe(key2);
  });

  it('propagates supabase error as a throw', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new Error('Minimum top-up is ₹100'),
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWalletTopup(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(50)).rejects.toThrow('Minimum top-up');
    });
  });
});
