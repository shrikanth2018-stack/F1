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
 * Usage:
 *
 *   READS — filter queries:
 *     const bf = useBranchFilter();
 *     queryKey: [...QUERY_KEYS.FOO, bf.isActive ? bf.branchId ?? 'all' : 'off']
 *     if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId)
 *
 *   WRITES — tag new rows (MF-03 / BF-06 pattern):
 *     const bf = useBranchFilter();
 *     await supabase.from('foo').insert({ ..., branch_id: bf.branchIdForWrite });
 *
 *     branchIdForWrite returns:
 *       - JWT branch_id if set (typical staff / branch-admin write)
 *       - super-admin's selected branch when one is picked
 *       - 1 as the single-branch default — never null
 *
 *     Writing 1-as-default rather than null preserves correctness when
 *     branch_management_active flips on later: existing rows already have
 *     a usable branch_id, no backfill of NULL → 1 needed for rows written
 *     after this helper landed. (Pre-existing NULL rows from before the
 *     fix still need the one-time backfill — see MF-03 audit punch list
 *     item #14.)
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
  /**
   * Non-null branch_id for INSERT/UPDATE statements. Falls back to 1 in
   * single-branch mode (BF-06 pattern). Never null — use this anywhere a
   * new row needs a `branch_id` value. See MF-03 punch list class B
   * (writes-default-to-NULL anti-pattern across 9 hooks, 2026-05-04).
   */
  branchIdForWrite: number;
}

export function useBranchFilter(): BranchFilter {
  const { session } = useAuth();
  const isActive = useFeatureFlag('branch_management_active');
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId);

  const jwtBranchId: number | null = session?.branchId ?? null;
  const isSuperAdmin = session?.role === 'admin' && jwtBranchId === null;

  // JWT branch overrides store selection; super-admin uses store (may be null)
  const branchId = jwtBranchId ?? (isSuperAdmin ? selectedBranchId : null);
  // For writes: branchId or fall through to 1 (single-branch default).
  const branchIdForWrite = branchId ?? 1;

  return { branchId, isActive, isSuperAdmin, branchIdForWrite };
}
