/**
 * 1stOne F1 — useBranchFilter
 *
 * Central hook for multi-branch query filtering.
 *
 * Resolution order:
 *   1. JWT contains branch_id → always use that (branch-specific admin / staff)
 *   2. JWT has no branch_id AND role is admin → use store's selectedBranchId
 *      (super-admin; null = show all branches)
 *   3. branch_management_active flag is off → isActive = false, no filtering
 *
 * Usage in a query hook:
 *   const bf = useBranchFilter();
 *   queryKey: [...QUERY_KEYS.FOO, bf.isActive ? bf.branchId ?? 'all' : 'off']
 *   if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId)
 */

import { useAuth } from './useAuth';
import { useFeatureFlag } from './useFeatureFlag';
import { useBranchStore } from '../store/branchStore';

export interface BranchFilter {
  /** Resolved branch ID to filter by. null when super-admin views all. */
  branchId: number | null;
  /** True when the branch_management_active feature flag is on. */
  isActive: boolean;
  /**
   * True when the logged-in user is an admin with NO branch_id in their JWT.
   * These users can switch which branch they're viewing via the branch selector.
   */
  isSuperAdmin: boolean;
}

export function useBranchFilter(): BranchFilter {
  const { session } = useAuth();
  const isActive = useFeatureFlag('branch_management_active');
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId);

  const jwtBranchId: number | null = session?.branchId ?? null;
  const isSuperAdmin = session?.role === 'admin' && jwtBranchId === null;

  // JWT branch overrides store selection; super-admin uses store (may be null)
  const branchId = jwtBranchId ?? (isSuperAdmin ? selectedBranchId : null);

  return { branchId, isActive, isSuperAdmin };
}
