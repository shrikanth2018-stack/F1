/**
 * 1stOne F1 — useBanners
 *
 * Fetches live banners for the home screen carousel.
 * Schema uses is_live (not is_active) for banners.
 * Filtered by branch when branch_management_active is on.
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { Banner } from '../types';

export function useBanners() {
  const bf = useBranchFilter();

  return useSupabaseQuery<Banner>(
    [...QUERY_KEYS.BANNERS, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let q = supabase
        .from('banners')
        .select('*')
        .eq('is_live', true)
        .order('created_at', { ascending: false });
      if (bf.isActive && bf.branchId != null) {
        q = q.eq('branch_id', bf.branchId);
      }
      return q;
    }
  );
}
