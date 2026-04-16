/**
 * 1stOne F1 — useBranches
 *
 * Fetches the list of branches. Used by the super-admin branch selector
 * in AdminHome to let them switch which branch's data they're viewing.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useFeatureFlag } from './useFeatureFlag';
import type { Branch } from '../types';

export function useBranches() {
  const isActive = useFeatureFlag('branch_management_active');

  return useQuery<Branch[]>({
    queryKey: [...QUERY_KEYS.BRANCHES, 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, branch_name, is_active, created_at')
        .eq('is_active', true)
        .order('branch_name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Branch[];
    },
    staleTime: QUERY_STALE_TIME,
    enabled: isActive,
  });
}
