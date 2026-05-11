/**
 * 1stOne F1 — useBranches
 *
 * Default: fetches active branches for the super-admin branch selector
 * in AdminHome and admin branch-picker dropdowns (OnboardEmployee,
 * EmployeeDetail).
 * With { includeInactive: true }: fetches all branches for the super-admin
 * Branches Manage screen (FT-04). Cached under a distinct key so the
 * selector dropdown's active-only cache isn't polluted.
 *
 * Not gated on the `branch_management_active` feature flag — that flag
 * gates the customer-facing multi-branch experience only. Super-admin
 * branch management must function regardless so branches can be set up
 * before the flag flips.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { Branch } from '../types';

export function useBranches(opts?: { includeInactive?: boolean }) {
  const includeInactive = opts?.includeInactive === true;

  return useQuery<Branch[]>({
    queryKey: [...QUERY_KEYS.BRANCHES, includeInactive ? 'all' : 'active'],
    queryFn: async () => {
      let query = supabase
        .from('branches')
        .select('id, branch_name, address, phone, is_active, created_at')
        .order('branch_name', { ascending: true });
      if (!includeInactive) {
        query = query.eq('is_active', true);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as Branch[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}
