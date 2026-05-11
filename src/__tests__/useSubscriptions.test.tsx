/**
 * Tests for the subscription mutation hooks.
 *
 * Covers:
 *   - useAdminCancelSubscription (BF-20 atomic cancel + refund RPC)
 *   - usePauseSubscription (customer pause/resume; RLS-side guards)
 *   - useSkipDay / useUndoSkip (customer day-level skip via
 *     cancelled_subscription_days)
 */

// AsyncStorage mock — useSubscriptions hooks transitively load useAuth.
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

// ── Supabase mock — chainable query builder + rpc ────────

const mockRpc = jest.fn();
const mockEqChain = jest.fn();
const mockInsert = jest.fn();
const mockDelete = jest.fn();
const mockUpdate = jest.fn();

// Builder pattern: each from(table).x(...).y(...) returns this; awaiting
// resolves to {data, error}. Tests set up by chaining mockEqChain etc.
function makeBuilder(resolveValue: any) {
  const builder: any = {};
  const chain = [
    'select', 'eq', 'in', 'order', 'limit', 'gte', 'lte',
    'maybeSingle', 'single', 'range',
    'insert', 'update', 'upsert', 'delete',
  ];
  for (const fn of chain) builder[fn] = jest.fn(() => builder);
  // Final await unwraps to a thenable
  builder.then = (onFulfilled: any) => Promise.resolve(resolveValue).then(onFulfilled);
  return builder;
}

let mockFromImpl: jest.Mock = jest.fn();

jest.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFromImpl(...args),
    auth: { getSession: jest.fn() },
    functions: { invoke: jest.fn() },
  },
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    session: {
      user: { id: 'user-555', phone: '915555555555' },
      role: 'customer',
      assignedHubId: null,
      branchId: 1,
      isDriver: false,
    },
    isLoading: false,
  }),
}));

import {
  useAdminCancelSubscription,
  usePauseSubscription,
  useSkipDay,
  useUndoSkip,
} from '@/hooks/useSubscriptions';

beforeEach(() => {
  mockRpc.mockReset();
  mockEqChain.mockReset();
  mockInsert.mockReset();
  mockDelete.mockReset();
  mockUpdate.mockReset();
  mockFromImpl = jest.fn();
});

// ── useAdminCancelSubscription ───────────────────────────

describe('useAdminCancelSubscription — BF-20 atomic cancel', () => {
  it('calls admin_cancel_subscription_atomic with sub id + refund amount', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminCancelSubscription(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ subscriptionId: 39, refundAmount: 1500 });
    });

    expect(mockRpc).toHaveBeenCalledWith('admin_cancel_subscription_atomic', {
      p_subscription_id: 39,
      p_refund_amount: 1500,
    });
  });

  it('throws when RPC errors (e.g. already inactive)', async () => {
    mockRpc.mockResolvedValueOnce({
      error: { message: 'subscription 39 is already inactive — cannot cancel again' },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminCancelSubscription(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ subscriptionId: 39, refundAmount: 0 }),
      ).rejects.toThrow('already inactive');
    });
  });

  it('zero refundAmount still calls RPC (atomic deactivate-only path)', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAdminCancelSubscription(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ subscriptionId: 39, refundAmount: 0 });
    });

    expect(mockRpc.mock.calls[0][1].p_refund_amount).toBe(0);
  });
});

// ── usePauseSubscription ────────────────────────────────

describe('usePauseSubscription — RLS guards via .eq chain', () => {
  it('UPDATEs is_paused with owner + active guards', async () => {
    const builder = makeBuilder({ data: null, error: null });
    mockFromImpl.mockReturnValueOnce(builder);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => usePauseSubscription(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 39, pause: true });
    });

    expect(mockFromImpl).toHaveBeenCalledWith('user_subscriptions');
    expect(builder.update).toHaveBeenCalledWith({ is_paused: true });
    // Owner guard: user can only pause their own sub.
    expect(builder.eq).toHaveBeenCalledWith('id', 39);
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-555');
    // Active guard: can't pause an inactive sub (DB-side defense in depth).
    expect(builder.eq).toHaveBeenCalledWith('is_active', true);
  });
});

// ── useSkipDay / useUndoSkip ────────────────────────────

describe('useSkipDay', () => {
  it('inserts a cancelled_subscription_days row with cycle_id', async () => {
    const builder = makeBuilder({ data: null, error: null });
    mockFromImpl.mockReturnValueOnce(builder);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSkipDay(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        subscription_id: 39,
        cancelled_date: '2026-05-15',
        cycle_id: 1,
      });
    });

    expect(mockFromImpl).toHaveBeenCalledWith('cancelled_subscription_days');
    expect(builder.insert).toHaveBeenCalledWith({
      subscription_id: 39,
      cancelled_date: '2026-05-15',
      cycle_id: 1,
      reason: 'Skipped by customer',
    });
  });

  it('passes through caller-provided reason', async () => {
    const builder = makeBuilder({ data: null, error: null });
    mockFromImpl.mockReturnValueOnce(builder);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSkipDay(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        subscription_id: 39,
        cancelled_date: '2026-05-15',
        cycle_id: 1,
        reason: 'travelling',
      });
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'travelling' }),
    );
  });
});

describe('useUndoSkip', () => {
  it('deletes the cancelled_subscription_days row by id', async () => {
    const builder = makeBuilder({ data: null, error: null });
    mockFromImpl.mockReturnValueOnce(builder);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUndoSkip(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 42 });
    });

    expect(mockFromImpl).toHaveBeenCalledWith('cancelled_subscription_days');
    expect(builder.delete).toHaveBeenCalledTimes(1);
    expect(builder.eq).toHaveBeenCalledWith('id', 42);
  });
});
