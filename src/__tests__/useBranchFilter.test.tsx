/**
 * Tests for useBranchFilter — MF-09 customer-path resolution.
 *
 * Locks in: customer sessions resolve branchId from their default
 * address's branch_id (falls back to first address, then null).
 * Admin / staff / super-admin paths untouched.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

import { renderHook } from '@testing-library/react-native';
import { createWrapper } from './_helpers/queryClient';

const mockUseAuth = jest.fn();
const mockUseFeatureFlag = jest.fn();
const mockUseAddresses = jest.fn();
const mockUseBranchStore = jest.fn();

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));
jest.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => mockUseFeatureFlag(...args),
}));
jest.mock('@/hooks/useAddresses', () => ({
  useAddresses: () => mockUseAddresses(),
}));
jest.mock('@/store/branchStore', () => ({
  useBranchStore: (selector: any) => mockUseBranchStore(selector),
}));

import { useBranchFilter } from '@/hooks/useBranchFilter';

beforeEach(() => {
  mockUseAuth.mockReset();
  mockUseFeatureFlag.mockReset();
  mockUseAddresses.mockReset();
  mockUseBranchStore.mockReset();
  mockUseFeatureFlag.mockReturnValue(true);
  mockUseBranchStore.mockReturnValue(null); // no super-admin selection
});

describe('useBranchFilter — customer path (MF-09)', () => {
  it('returns default address branch_id for a customer', () => {
    mockUseAuth.mockReturnValue({
      session: { role: 'customer', branchId: null, isSuperAdmin: false, user: { id: 'cust-1' } },
    });
    mockUseAddresses.mockReturnValue({
      data: [
        { id: 10, branch_id: 2, is_default: false },
        { id: 11, branch_id: 7, is_default: true },
      ],
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBranchFilter(), { wrapper: Wrapper });

    expect(result.current.branchId).toBe(7);
    expect(result.current.isSuperAdmin).toBe(false);
    expect(result.current.branchIdForWrite).toBe(7);
  });

  it('falls back to first address when no default is set', () => {
    mockUseAuth.mockReturnValue({
      session: { role: 'customer', branchId: null, isSuperAdmin: false, user: { id: 'cust-1' } },
    });
    mockUseAddresses.mockReturnValue({
      data: [
        { id: 20, branch_id: 3, is_default: false },
        { id: 21, branch_id: 5, is_default: false },
      ],
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBranchFilter(), { wrapper: Wrapper });

    expect(result.current.branchId).toBe(3);
  });

  it('returns null for a customer with no addresses yet', () => {
    mockUseAuth.mockReturnValue({
      session: { role: 'customer', branchId: null, isSuperAdmin: false, user: { id: 'cust-1' } },
    });
    mockUseAddresses.mockReturnValue({ data: [] });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBranchFilter(), { wrapper: Wrapper });

    expect(result.current.branchId).toBeNull();
    expect(result.current.branchIdForWrite).toBe(1); // single-branch default
  });

  it('JWT branch_id wins over address-derived branch for a customer-with-claim', () => {
    mockUseAuth.mockReturnValue({
      session: { role: 'customer', branchId: 9, isSuperAdmin: false, user: { id: 'cust-1' } },
    });
    mockUseAddresses.mockReturnValue({
      data: [{ id: 30, branch_id: 2, is_default: true }],
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBranchFilter(), { wrapper: Wrapper });

    expect(result.current.branchId).toBe(9);
  });

  it('admin path is unaffected — addresses are ignored', () => {
    mockUseAuth.mockReturnValue({
      session: { role: 'admin', branchId: 4, isSuperAdmin: false, user: { id: 'admin-1' } },
    });
    mockUseAddresses.mockReturnValue({
      data: [{ id: 40, branch_id: 99, is_default: true }],
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBranchFilter(), { wrapper: Wrapper });

    expect(result.current.branchId).toBe(4); // JWT wins
    expect(result.current.isSuperAdmin).toBe(false);
  });

  it('super-admin is now keyed on explicit isSuperAdmin claim (FT-05)', () => {
    mockUseAuth.mockReturnValue({
      session: { role: 'admin', branchId: null, isSuperAdmin: true, user: { id: 'super-1' } },
    });
    mockUseBranchStore.mockReturnValue(2);
    mockUseAddresses.mockReturnValue({
      data: [{ id: 50, branch_id: 99, is_default: true }],
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBranchFilter(), { wrapper: Wrapper });

    expect(result.current.isSuperAdmin).toBe(true);
    expect(result.current.branchId).toBe(2); // super-admin's selected branch
  });

  it('FT-05: admin with branch_id + isSuperAdmin=true is super-admin (no longer impossible)', () => {
    // Legacy convention required branch_id IS NULL for super-admin powers;
    // FT-05 lifts that. Owner overseeing branch 1 can now hold both.
    mockUseAuth.mockReturnValue({
      session: { role: 'admin', branchId: 1, isSuperAdmin: true, user: { id: 'super-1' } },
    });
    mockUseBranchStore.mockReturnValue(null);
    mockUseAddresses.mockReturnValue({ data: [] });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBranchFilter(), { wrapper: Wrapper });

    expect(result.current.isSuperAdmin).toBe(true);
    expect(result.current.branchId).toBe(1); // JWT branch wins for filter; super-admin powers separate
  });

  it('FT-05: admin without isSuperAdmin claim is NOT super-admin even with null branch', () => {
    // Defensive: a stray admin row with branch=null but no explicit
    // super-admin marker should not gain global powers.
    mockUseAuth.mockReturnValue({
      session: { role: 'admin', branchId: null, isSuperAdmin: false, user: { id: 'rogue-1' } },
    });
    mockUseBranchStore.mockReturnValue(null);
    mockUseAddresses.mockReturnValue({ data: [] });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBranchFilter(), { wrapper: Wrapper });

    expect(result.current.isSuperAdmin).toBe(false);
    expect(result.current.branchId).toBeNull();
  });
});
