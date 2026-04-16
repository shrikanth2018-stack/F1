/**
 * 1stOne F1 — useMenuItems
 *
 * Fetches active menu items filtered by the given cycle IDs.
 * Pass cycle IDs from useDeliveryCycles to scope the query server-side
 * and avoid unbounded growth as historical cycles accumulate.
 * Query is disabled until cycleIds are known.
 * Filtered by branch when branch_management_active is on.
 */

import { useMemo } from 'react';
import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { MenuItem } from '../types';

export function useMenuItems(cycleIds?: number[]) {
  const bf = useBranchFilter();

  // Memoize sort+spread so it doesn't allocate on every render
  const sortedIds = useMemo(
    () => (cycleIds?.length ? [...cycleIds].sort((a, b) => a - b) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cycleIds?.join(',')]
  );

  const queryKey = sortedIds
    ? [...QUERY_KEYS.MENU_ITEMS, ...sortedIds, bf.isActive ? bf.branchId ?? 'all' : 'off']
    : [...QUERY_KEYS.MENU_ITEMS, bf.isActive ? bf.branchId ?? 'all' : 'off'];

  return useSupabaseQuery<MenuItem>(
    queryKey,
    () => {
      let q = supabase
        .from('menu_items')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (sortedIds) {
        q = q.in('cycle_id', sortedIds);
      }
      if (bf.isActive && bf.branchId != null) {
        q = q.eq('branch_id', bf.branchId);
      }
      return q;
    },
    { enabled: sortedIds !== undefined }
  );
}
