/**
 * 1stOne F1 — useDeliveryCycles
 *
 * Fetches active delivery cycles from Supabase.
 * Returns cycles sorted by sort_order.
 * Filtered by branch when branch_management_active is on.
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { DeliveryCycle } from '../types';

export function useDeliveryCycles() {
  const bf = useBranchFilter();

  return useSupabaseQuery<DeliveryCycle>(
    [...QUERY_KEYS.DELIVERY_CYCLES, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let q = supabase
        .from('delivery_cycles')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (bf.isActive && bf.branchId != null) {
        q = q.eq('branch_id', bf.branchId);
      }
      return q;
    }
  );
}
