/**
 * Tests for useStaffOrders — the staff dashboard data hook (also reused
 * by HubDashboardScreen). Locks in BF-31 (sub-purchase exclusion at
 * hook level) + branch filter + hub filter behaviors end-to-end.
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
    'select', 'eq', 'neq', 'in', 'order', 'limit', 'gte', 'lte',
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

import { useStaffOrders } from '@/hooks/useStaffOrders';

beforeEach(() => {
  mockFromImpl = jest.fn();
  mockBranchFilter.mockReset();
  mockFeatureFlag.mockReset();
  mockAuth.mockReset();
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
        order_items: [{ item_type: 'food' }],
        customer_addresses: { hub_id: null },
      },
      {
        id: 2, // sub-purchase
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
      order_items: [{ item_type: 'food' }, { item_type: 'subscription' }],
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
      { id: 1, order_items: [{ item_type: 'food' }], customer_addresses: { hub_id: 19 } },
      { id: 2, order_items: [{ item_type: 'food' }], customer_addresses: { hub_id: 20 } },
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
      { id: 1, order_items: [{ item_type: 'food' }], customer_addresses: { hub_id: 19 } },
      { id: 2, order_items: [{ item_type: 'food' }], customer_addresses: { hub_id: 20 } },
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
