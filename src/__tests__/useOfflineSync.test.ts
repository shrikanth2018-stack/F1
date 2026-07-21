/**
 * Tests for useOfflineSync — the staff offline-queue drain (health report
 * #14). Locks in the three guards that protect order data on shared,
 * low-signal devices:
 *   - identity guard: another user's queued mutation is discarded (G3-adjacent)
 *   - no-regress guard: a queued status update only applies while the order
 *     is still EARLIER than the target (G3)
 *   - retry cap: a mutation is dropped after MAX_QUEUE_RETRIES — and, since
 *     Slice A, the drop is captured to Sentry (#17)
 * Plus: the customer push fires only when the update actually landed, and
 * no session leaves the queue untouched.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

// NetInfo: capture the listener; connectivity is driven manually per test.
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => () => {}),
    fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
  },
}));

const mockGetUser = jest.fn();
let mockFromImpl: jest.Mock = jest.fn();
jest.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFromImpl(...args),
    auth: { getUser: () => mockGetUser() },
  },
}));

const mockFirePush = jest.fn();
jest.mock('@/utils/orderStatusPush', () => ({
  fireOrderStatusPush: (...args: unknown[]) => mockFirePush(...args),
}));

const mockCaptureError = jest.fn();
jest.mock('@/utils/sentry', () => ({
  captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

import { renderHook, act } from '@testing-library/react-native';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useStaffQueueStore, type QueuedMutation } from '@/store/staffQueueStore';
import { MAX_QUEUE_RETRIES } from '@/utils/constants';
import { ORDER_STATUS_FLOW } from '@/utils/orderStatus';

// Chainable builder that records calls; await resolves to `resolveValue`.
function makeBuilder(resolveValue: unknown) {
  const builder: any = { calls: {} as Record<string, unknown[][]> };
  for (const fn of ['update', 'insert', 'upsert', 'eq', 'in', 'select']) {
    builder.calls[fn] = [];
    builder[fn] = jest.fn((...args: unknown[]) => {
      builder.calls[fn].push(args);
      return builder;
    });
  }
  builder.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(resolveValue).then(onFulfilled, onRejected);
  return builder;
}

const baseMutation = (over: Partial<QueuedMutation> = {}): QueuedMutation => ({
  id: 'q_1',
  userId: 'staff-A',
  table: 'orders',
  operation: 'update',
  payload: { status: 'Packed', updated_at: '2026-07-21T00:00:00Z' },
  matchColumn: 'id',
  matchValue: 42,
  notifyUserId: 'cust-1',
  createdAt: 1,
  retryCount: 0,
  ...over,
});

const seedQueue = (mutations: QueuedMutation[]) =>
  useStaffQueueStore.setState({ queue: mutations, isSyncing: false });

const drain = async () => {
  const { result, unmount } = renderHook(() => useOfflineSync());
  await act(async () => {
    await result.current.manualSync();
  });
  unmount();
};

beforeEach(() => {
  jest.clearAllMocks();
  useStaffQueueStore.setState({ queue: [], isSyncing: false });
  mockGetUser.mockResolvedValue({ data: { user: { id: 'staff-A' } } });
});

describe('useOfflineSync — drain guards', () => {
  it('applies a queued order update with the no-regress status filter (G3)', async () => {
    const builder = makeBuilder({ data: [{ id: 42 }], error: null });
    mockFromImpl = jest.fn(() => builder);
    seedQueue([baseMutation()]);

    await drain();

    expect(mockFromImpl).toHaveBeenCalledWith('orders');
    expect(builder.calls.eq[0]).toEqual(['id', 42]);
    // Target 'Packed' → only statuses strictly earlier may still match.
    const packedIdx = ORDER_STATUS_FLOW.indexOf('Packed');
    expect(builder.calls.in[0]).toEqual(['status', ORDER_STATUS_FLOW.slice(0, packedIdx)]);
    // Applied → dequeued + customer push fired.
    expect(useStaffQueueStore.getState().queue).toHaveLength(0);
    expect(mockFirePush).toHaveBeenCalledWith(42, 'Packed', 'cust-1');
  });

  it('suppresses the push when the guard matched 0 rows (order already past)', async () => {
    mockFromImpl = jest.fn(() => makeBuilder({ data: [], error: null }));
    seedQueue([baseMutation()]);

    await drain();

    // Dequeued as a harmless no-op — but NO stale push to the customer.
    expect(useStaffQueueStore.getState().queue).toHaveLength(0);
    expect(mockFirePush).not.toHaveBeenCalled();
  });

  it("discards another user's mutation without touching the network (identity guard)", async () => {
    mockFromImpl = jest.fn(() => makeBuilder({ data: [], error: null }));
    seedQueue([baseMutation({ userId: 'staff-B' })]);

    await drain();

    expect(mockFromImpl).not.toHaveBeenCalled();
    expect(useStaffQueueStore.getState().queue).toHaveLength(0);
    expect(mockFirePush).not.toHaveBeenCalled();
  });

  it('drops a mutation at MAX_QUEUE_RETRIES and captures it to Sentry (#17)', async () => {
    mockFromImpl = jest.fn(() => makeBuilder({ data: [], error: null }));
    seedQueue([baseMutation({ retryCount: MAX_QUEUE_RETRIES })]);

    await drain();

    expect(mockFromImpl).not.toHaveBeenCalled();
    expect(useStaffQueueStore.getState().queue).toHaveLength(0);
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [err, ctx] = mockCaptureError.mock.calls[0];
    expect((err as Error).message).toMatch(/dropped after max retries/);
    expect(ctx).toMatchObject({ table: 'orders', matchValue: 42, retryCount: MAX_QUEUE_RETRIES });
  });

  it('increments retryCount (keeps the mutation) when the write errors', async () => {
    mockFromImpl = jest.fn(() => makeBuilder({ data: null, error: { message: 'boom' } }));
    seedQueue([baseMutation()]);

    await drain();

    const queue = useStaffQueueStore.getState().queue;
    expect(queue).toHaveLength(1);
    expect(queue[0].retryCount).toBe(1);
    expect(mockFirePush).not.toHaveBeenCalled();
  });

  it('leaves the whole queue intact when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockFromImpl = jest.fn(() => makeBuilder({ data: [], error: null }));
    seedQueue([baseMutation()]);

    await drain();

    expect(mockFromImpl).not.toHaveBeenCalled();
    expect(useStaffQueueStore.getState().queue).toHaveLength(1);
  });

  it('replays inserts (e.g. attendance) without the status guard', async () => {
    const builder = makeBuilder({ data: [{ id: 1 }], error: null });
    mockFromImpl = jest.fn(() => builder);
    seedQueue([baseMutation({
      table: 'staff_attendance',
      operation: 'insert',
      payload: { staff_id: 'staff-A', date: '2026-07-21' },
      matchColumn: undefined,
      matchValue: undefined,
      notifyUserId: null,
    })]);

    await drain();

    expect(mockFromImpl).toHaveBeenCalledWith('staff_attendance');
    expect(builder.insert).toHaveBeenCalled();
    expect(builder.in).not.toHaveBeenCalled();
    expect(useStaffQueueStore.getState().queue).toHaveLength(0);
    expect(mockFirePush).not.toHaveBeenCalled();
  });
});
