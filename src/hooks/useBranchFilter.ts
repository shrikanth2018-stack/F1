/**
 * 1stOne F1 — useBranchFilter
 *
 * Central hook for multi-branch query filtering.
 *
 * Resolution order:
 *   1. JWT contains branch_id → always use that (branch-specific admin / staff)
 *   2. JWT has no branch_id AND role is admin → use store's selectedBranchId
 *      (super-admin; null = show all branches)
 *   3. Customer session → use default address's branch_id (MF-09). Falls
 *      back to first address, then null when the customer has no addresses
 *      or addresses haven't loaded yet.
 *   4. branch_management_active flag is off → isActive = false, no filtering
 *
 * Usage:
 *
 *   READS — filter queries:
 *     const bf = useBranchFilter();
 *     queryKey: [...QUERY_KEYS.FOO, bf.isActive ? bf.branchId ?? 'all' : 'off']
 *     if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId)
 *
 *   WRITES — tag new rows:
 *     const bf = useBranchFilter();
 *     await supabase.from('foo').insert({ ..., branch_id: requireWriteBranch(bf) });
 *
 *     branchIdForWrite is the resolved branch for a write, or null when it
 *     cannot be determined — a super-admin viewing "All Branches" with no
 *     branch selected. NEVER write branchIdForWrite directly: pass it through
 *     requireWriteBranch(), which throws a clear error when the branch is
 *     unresolved. A throw surfaces as a mutation error the admin can act on
 *     ("pick a branch"); silently defaulting to a literal branch id would
 *     misroute the row the day a second branch goes live.
 */

import { useAuth } from './useAuth';
import { useFeatureFlag } from './useFeatureFlag';
import { useBranchStore } from '../store/branchStore';
import { useAddresses } from './useAddresses';
import { useBranches } from './useBranches';

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
   * Resolved branch_id for INSERT/UPDATE statements, or null when it cannot
   * be determined (a super-admin on "All Branches"). Do NOT write this value
   * directly — pass it through requireWriteBranch() so an unresolved branch
   * fails loud instead of silently misrouting the row to a default branch.
   */
  branchIdForWrite: number | null;
}

export function useBranchFilter(): BranchFilter {
  const { session } = useAuth();
  const isActive = useFeatureFlag('branch_management_active');
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId);

  const jwtBranchId: number | null = session?.branchId ?? null;
  // FT-05: explicit super-admin marker from JWT claim. Replaces the
  // legacy "admin + null branchId" convention so a super-admin may
  // also carry a home branch_id without losing global powers.
  const isSuperAdmin = session?.isSuperAdmin === true;
  // Customer = anyone whose role isn't admin/staff. Drivers + hub-ops still
  // route through the customer side (CustomerNavigator); they may not have
  // addresses but useAddresses returns [] cleanly in that case.
  const isCustomer = session?.role !== 'admin' && session?.role !== 'staff';

  // Address-derived branch for customers. useAddresses' enabled flag
  // already skips this when there's no authenticated session.
  const { data: addresses } = useAddresses();
  const customerBranchId = isCustomer
    ? (addresses ?? []).find((a) => a.is_default)?.branch_id
      ?? addresses?.[0]?.branch_id
      ?? null
    : null;

  // Single-branch fallback: when exactly one branch exists, every row
  // belongs to it — so resolve to that branch automatically instead of
  // forcing a super-admin to "pick" from a list of one. The multi-branch
  // guard (requireWriteBranch throws on null) returns the instant a 2nd
  // branch is created.
  const { data: branches } = useBranches();
  const soleBranchId = branches?.length === 1 ? branches[0].id : null;

  // JWT branch overrides everything; super-admin uses store selection;
  // customer falls through to default-address branch; finally, if there
  // is only one branch, that branch.
  const branchId = jwtBranchId
    ?? (isSuperAdmin ? selectedBranchId : null)
    ?? customerBranchId
    ?? soleBranchId;
  // Writes use the same resolved branch — null only when 2+ branches exist
  // and none is selected. Callers must guard via requireWriteBranch().
  const branchIdForWrite = branchId;

  return { branchId, isActive, isSuperAdmin, branchIdForWrite };
}

/**
 * Resolve the branch_id for a write, or throw. Use at every INSERT/UPDATE
 * site that tags a row with branch_id. Throws when the branch cannot be
 * resolved — a super-admin on "All Branches" must select a specific branch
 * before creating branch-scoped data. The throw surfaces as a mutation error
 * rather than silently writing the row to the wrong branch.
 */
export function requireWriteBranch(bf: BranchFilter): number {
  if (bf.branchIdForWrite == null) {
    throw new Error('No branch selected. Pick a specific branch before creating or editing branch data.');
  }
  return bf.branchIdForWrite;
}
