/**
 * Tests for useStaffOrders — the staff dashboard data hook (also reused
 * by HubDashboardScreen). Locks in BF-31 (sub-purchase exclusion at
 * hook level) + branch filter + hub filter behaviors, plus the active-
 * batch scoping (orders shown only for the most recent kitchen push).
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

import { renderHook, waitFor } from '@testing-library/react-native';
import { createWrapper } from './_helpers/queryClient';

// Builder mock — supabase.from(table).select(...).eq(...).order(...) chain
// terminates on await: returns { data, error } from `resolveValue`.
function makeBuilder(resolveValue: any) {
  const builder: any = {};
  const chain = [
    'select', 'eq', 'neq', 'in', 'or', 'order', 'limit', 'gte', 'lte',
    'maybeSingle', 'single', 'range',
    'insert', 'update', 'upsert', 'delete',
  ];
  for (const fn of chain) builder[fn] = jest.fn(() => builder);
  builder.then = (onFulfilled: any) => Promise.resolve(resolveValue).then(onFulfilled);
  return builder;
}

let mockFromImpl: jest.Mock = jest.fn();

jest.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFromImpl(...args),
    auth: { getSession: jest.fn() },
    functions: { invoke: jest.fn() },
    rpc: jest.fn(),
  },
}));

// useBranchFilter controlled per-test
const mockBranchFilter = jest.fn();
jest.mock('@/hooks/useBranchFilter', () => ({
  useBranchFilter: () => mockBranchFilter(),
}));

// Feature flag controlled per-test
const mockFeatureFlag = jest.fn();
jest.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => mockFeatureFlag(...args),
}));

// useAuth session controlled per-test
const mockAuth = jest.fn();
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockAuth(),
}));

// Active staff batch controlled per-test — the cycle released by the
// most recent kitchen push. useStaffOrders scopes its query to it.
const mockActiveStaffBatch = jest.fn();
jest.mock('@/hooks/useActiveStaffBatch', () => ({
  useActiveStaffBatch: () => mockActiveStaffBatch(),
}));

// The hook now needs each cycle's delivery time to tell an order from an
// EARLIER cycle of today (still owed) from one that has not come due yet.
// Mocked with the real Breakfast/Lunch/Snacks/Dinner windows.
jest.mock('@/hooks/useDeliveryCycles', () => ({
  useDeliveryCycles: () => ({
    data: [
      { id: 1, delivery_start: '07:30:00' },
      { id: 2, delivery_start: '12:30:00' },
      { id: 3, delivery_start: '16:30:00' },
      { id: 4, delivery_start: '19:30:00' },
    ],
  }),
}));

import { useStaffOrders } from '@/hooks/useStaffOrders';

beforeEach(() => {
  mockFromImpl = jest.fn();
  mockBranchFilter.mockReset();
  mockFeatureFlag.mockReset();
  mockAuth.mockReset();
  mockActiveStaffBatch.mockReset();
  // Default: a cycle has been pushed — the staff board has a live batch.
  mockActiveStaffBatch.mockReturnValue({ data: { cycle_id: 4, push_date: '2026-05-17' } });
});

const baseSession = {
  user: { id: 'staff-1', phone: '916666666666' },
  role: 'staff',
  assignedHubId: null,
  branchId: 1,
  isDriver: false,
};

// ── BF-31 integration ────────────────────────────────────

describe('useStaffOrders — BF-31 sub-purchase exclusion (hook integration)', () => {
  it('regression BF-31: sub-purchase rows are filtered out at the hook level', async () => {
    // Mock returns one operational + one sub-purchase order.
    const orders = [
      {
        id: 1,
        cycle_id: 4, dispatch_date: '2026-05-17',
        order_items: [{ item_type: 'food' }],
        customer_addresses: { hub_id: null },
      },
      {
        id: 2, // sub-purchase
        cycle_id: 4, dispatch_date: '2026-05-17',
        order_items: [{ item_type: 'subscription' }],
        customer_addresses: { hub_id: null },
      },
    ];
    mockFromImpl.mockReturnValueOnce(makeBuilder({ data: orders, error: null }));
    mockBranchFilter.mockReturnValue({ isActive: false, branchId: null });
    mockFeatureFlag.mockReturnValue(false);
    mockAuth.mockReturnValue({ session: baseSession });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStaffOrders(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].id).toBe(1);
  });

  it('lets mixed-item orders (food + subscription line) through', async () => {
    const orders = [{
      id: 5,
      cycle_id: 4, dispatch_date: '2026-05-17', order_items: [{ item_type: 'food' }, { item_type: 'subscription' }],
      customer_addresses: { hub_id: null },
    }];
    mockFromImpl.mockReturnValueOnce(makeBuilder({ data: orders, error: null }));
    mockBranchFilter.mockReturnValue({ isActive: false, branchId: null });
    mockFeatureFlag.mockReturnValue(false);
    mockAuth.mockReturnValue({ session: baseSession });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStaffOrders(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});

// ── Branch filter integration (MF-03 Class B) ───────────

describe('useStaffOrders — branch filter applied when active', () => {
  it('passes branch_id=N when branch_management_active is on', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFromImpl.mockReturnValueOnce(builder);
    mockBranchFilter.mockReturnValue({ isActive: true, branchId: 2 });
    mockFeatureFlag.mockReturnValue(false);
    mockAuth.mockReturnValue({ session: baseSession });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStaffOrders(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(builder.eq).toHaveBeenCalledWith('branch_id', 2);
  });

  it('skips branch_id filter when feature flag off (single-branch mode)', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFromImpl.mockReturnValueOnce(builder);
    mockBranchFilter.mockReturnValue({ isActive: false, branchId: null });
    mockFeatureFlag.mockReturnValue(false);
    mockAuth.mockReturnValue({ session: baseSession });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStaffOrders(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const eqCalls = builder.eq.mock.calls as any[][];
    const branchIdCall = eqCalls.find((args) => args[0] === 'branch_id');
    expect(branchIdCall).toBeUndefined();
  });
});

// ── Hub filter (BF-04 / BF-12) ───────────────────────────

describe('useStaffOrders — hub-operator filtering', () => {
  it('client-filters to assigned_hub_id when hub_delivery_active + session has hub', async () => {
    const orders = [
      { id: 1, cycle_id: 4, dispatch_date: '2026-05-17', order_items: [{ item_type: 'food' }], customer_addresses: { hub_id: 19 } },
      { id: 2, cycle_id: 4, dispatch_date: '2026-05-17', order_items: [{ item_type: 'food' }], customer_addresses: { hub_id: 20 } },
    ];
    mockFromImpl.mockReturnValueOnce(makeBuilder({ data: orders, error: null }));
    mockBranchFilter.mockReturnValue({ isActive: false, branchId: null });
    mockFeatureFlag.mockReturnValue(true);
    mockAuth.mockReturnValue({
      session: { ...baseSession, role: 'customer', assignedHubId: 19 },
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStaffOrders(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].id).toBe(1);
  });

  it('returns all operational orders when feature flag off', async () => {
    const orders = [
      { id: 1, cycle_id: 4, dispatch_date: '2026-05-17', order_items: [{ item_type: 'food' }], customer_addresses: { hub_id: 19 } },
      { id: 2, cycle_id: 4, dispatch_date: '2026-05-17', order_items: [{ item_type: 'food' }], customer_addresses: { hub_id: 20 } },
    ];
    mockFromImpl.mockReturnValueOnce(makeBuilder({ data: orders, error: null }));
    mockBranchFilter.mockReturnValue({ isActive: false, branchId: null });
    mockFeatureFlag.mockReturnValue(false);
    mockAuth.mockReturnValue({ session: { ...baseSession, assignedHubId: 19 } });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStaffOrders(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });
});

// ── Active-batch scoping ─────────────────────────────────

describe('useStaffOrders — active-batch scoping', () => {
  it('scopes the query to the active batch cycle_id + push_date', async () => {
    const builder = makeBuilder({ data: [], error: null });
    mockFromImpl.mockReturnValueOnce(builder);
    mockBranchFilter.mockReturnValue({ isActive: false, branchId: null });
    mockFeatureFlag.mockReturnValue(false);
    mockAuth.mockReturnValue({ session: baseSession });
    mockActiveStaffBatch.mockReturnValue({ data: { cycle_id: 7, push_date: '2026-06-01' } });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStaffOrders(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // cycle + push_date now go into a PostgREST .or() (active batch OR
    // unsuccessful-delivery, D2), not separate .eq() calls.
    const orArg = (builder.or.mock.calls[0]?.[0] ?? '') as string;
    expect(orArg).toContain('cycle_id.eq.7');
    expect(orArg).toContain('dispatch_date.eq.2026-06-01');
  });

  it('still queries unsuccessful-delivery orders when no cycle has been pushed', async () => {
    // D2: even with no active batch, a past-dated undelivered order must
    // surface — so the hook still runs a query (the unsuccessful clause).
    const builder = makeBuilder({ data: [], error: null });
    mockFromImpl.mockReturnValueOnce(builder);
    mockBranchFilter.mockReturnValue({ isActive: false, branchId: null });
    mockFeatureFlag.mockReturnValue(false);
    mockAuth.mockReturnValue({ session: baseSession });
    mockActiveStaffBatch.mockReturnValue({ data: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStaffOrders(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFromImpl).toHaveBeenCalled();
    const orArg = (builder.or.mock.calls[0]?.[0] ?? '') as string;
    expect(orArg).toContain('status.not.in.(Delivered,Cancelled,Failed)');
    expect(result.current.data).toEqual([]);
  });

  it('stays pending until the active-batch lookup resolves', async () => {
    mockBranchFilter.mockReturnValue({ isActive: false, branchId: null });
    mockFeatureFlag.mockReturnValue(false);
    mockAuth.mockReturnValue({ session: baseSession });
    mockActiveStaffBatch.mockReturnValue({ data: undefined });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useStaffOrders(), { wrapper: Wrapper });

    // enabled:false while the batch is unknown — never fetches.
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFromImpl).not.toHaveBeenCalled();
  });
});
