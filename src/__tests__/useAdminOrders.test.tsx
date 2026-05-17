/**
 * Tests for useAdminCancelOrder — the BF-34a atomic admin cancel RPC.
 *
 * Locks in: hook calls admin_cancel_order_atomic with the right params
 * (RPC name, p_order_id, p_refund_amount, p_reason) and fires the
 * "Cancelled" customer push fan-out via send-push.
 */

// AsyncStorage mock — anything that loads useAuth (which imports cartStore)
// transitively needs this. Same pattern as cartStore.test.ts.
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

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    auth: { getSession: () => mockGetSession() },
    from: jest.fn(),
  },
}));

jest.mock('@/api/invalidateOrderQueries', () => ({
  invalidateOrderQueries: jest.fn(),
}));

// useAdminOrders imports useBranchFilter which imports useAuth. Mock the
// branch filter so the import chain doesn't try to actually parse a JWT.
jest.mock('@/hooks/useBranchFilter', () => ({
  useBranchFilter: () => ({
    isActive: false,
    branchId: null,
    branchIdForWrite: null,
    isSuperAdmin: false,
  }),
}));

import { useAdminCancelOrder } from '@/hooks/useAdminOrders';

beforeEach(() => {
  mockRpc.mockReset();
  mockInvoke.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'admin-token' } } });
});

describe('useAdminCancelOrder — BF-34a atomic cancel', () => {
  it('calls admin_cancel_order_atomic with order id, refund amount, and reason', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    // firePush invoke — fire-and-forget, returns whatever
    mockInvoke.mockResolvedValue({ data: { sent: 1 }, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminCancelOrder(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        orderId: 9442,
        refundAmount: 250,
        userId: 'cust-1',
        reason: 'Customer requested by phone',
      });
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = mockRpc.mock.calls[0];
    expect(rpcName).toBe('admin_cancel_order_atomic');
    expect(rpcArgs).toEqual({
      p_order_id: 9442,
      p_refund_amount: 250,
      p_reason: 'Customer requested by phone',
    });
  });

  it('passes p_reason default when reason is omitted', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    mockInvoke.mockResolvedValue({ data: { sent: 1 }, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminCancelOrder(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        orderId: 9442,
        refundAmount: 0,
        userId: 'cust-1',
      });
    });

    expect(mockRpc.mock.calls[0][1].p_reason).toBe('Cancelled by admin');
  });

  it('throws when RPC returns an error (atomic rollback path)', async () => {
    mockRpc.mockResolvedValueOnce({
      error: { message: 'order 9442 is already Cancelled' },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminCancelOrder(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          orderId: 9442,
          refundAmount: 250,
          userId: 'cust-1',
        }),
      ).rejects.toThrow('already Cancelled');
    });
  });

  it('fires customer "Cancelled" push after successful RPC', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    mockInvoke.mockResolvedValue({ data: { sent: 1 }, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminCancelOrder(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        orderId: 9442,
        refundAmount: 0,
        userId: 'cust-1',
      });
    });

    // firePush is fire-and-forget; allow microtasks to flush
    await new Promise((r) => setTimeout(r, 0));

    expect(mockInvoke).toHaveBeenCalledWith(
      'send-push',
      expect.objectContaining({
        body: expect.objectContaining({
          user_ids: ['cust-1'],
          title: 'Order Cancelled',
        }),
      }),
    );
  });
});
