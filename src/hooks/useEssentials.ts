/**
 * 1stOne F1 — useEssentials
 *
 * Essentials module hooks (feature-flagged):
 * - Fetch essentials catalog
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { EssentialItem } from '../types';

/** Fetch active essentials catalog items */
export function useEssentialsCatalog(cycleId?: number) {
  return useQuery({
    queryKey: [...QUERY_KEYS.ESSENTIALS, cycleId ?? 'all'],
    queryFn: async () => {
      let query = supabase
        .from('essentials_catalog')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (cycleId) {
        query = query.eq('cycle_id', cycleId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as EssentialItem[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

