/**
 * 1stOne F1 — useEssentials
 *
 * Essentials module hooks (feature-flagged):
 * - Fetch essentials catalog
 *
 * Branch-filtered for customers via useBranchFilter — see MF-09: the
 * customer's default address's branch_id drives which branch's items
 * are visible. Customers with no default address (just-onboarded) see
 * all branches' items until they add one.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { EssentialItem } from '../types';

/** Fetch active essentials catalog items */
export function useEssentialsCatalog(cycleId?: number) {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: [
      ...QUERY_KEYS.ESSENTIALS,
      cycleId ?? 'all',
      bf.isActive ? bf.branchId ?? 'all' : 'off',
    ],
    queryFn: async () => {
      let query = supabase
        .from('essentials_catalog')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (cycleId) {
        query = query.eq('cycle_id', cycleId);
      }
      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as EssentialItem[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}
