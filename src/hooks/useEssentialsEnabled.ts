/**
 * 1stOne F1 — useEssentialsEnabled
 *
 * Per-branch essentials gate. Replaces the global
 * useFeatureFlag('essentials_module_active') everywhere on the customer
 * surface.
 *
 * Resolution:
 *   - useBranchFilter resolves the user's branch (JWT for admin/staff,
 *     default-address branch_id for customers, sole-branch fallback otherwise).
 *   - Look up that branch's `essentials_enabled` column.
 *
 * Permissive defaults:
 *   - Branches list still loading → true. Avoids a flicker hiding essentials
 *     on first render.
 *   - No branch resolved (super-admin on All Branches, customer pre-signup
 *     with no addresses) → true. Same reasoning: don't lock the customer out
 *     of essentials before we even know which branch they belong to.
 *
 * The legacy feature_flags.essentials_module_active row is intentionally
 * NOT read here. It stays in the DB for one release as a safety net but
 * the source of truth is now `branches.essentials_enabled`.
 */

import { useBranchFilter } from './useBranchFilter';
import { useBranches } from './useBranches';

export function useEssentialsEnabled(): boolean {
  const bf = useBranchFilter();
  const { data: branches } = useBranches();

  if (!branches) return true;
  if (bf.branchId == null) return true;

  const branch = branches.find((b) => b.id === bf.branchId);
  return branch?.essentials_enabled !== false;
}
