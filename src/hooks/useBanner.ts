/**
 * 1stOne F1 — useBanner
 *
 * Reads the live banner from the `banners` table.
 * banner_type = 'image' → render image_url
 * banner_type = 'text'  → render custom styled banner from text_content JSON
 *
 * Admin upserts via useUpsertBanner (single live record, no pagination needed).
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { Banner } from '../types';

export interface CustomBannerContent {
  title: string;
  subtitle?: string;
  bg_color: string;
  text_color: string;
  emoji?: string;
  pulse?: boolean;
}

export function useLiveBanner() {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['live_banner', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('banners')
        .select('*')
        .eq('is_live', true)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      return data as Banner | null;
    },
    staleTime: QUERY_STALE_TIME,
  });
}

export function useUpsertBanner() {
  const queryClient = useQueryClient();
  const bf = useBranchFilter();
  return useMutation({
    mutationFn: async (
      payload: Pick<Banner, 'banner_type' | 'image_url' | 'text_content' | 'is_live'>
    ) => {
      // First set all existing banners to not live (scoped to branch if applicable)
      let offQuery = supabase.from('banners').update({ is_live: false }).neq('id', 0);
      if (bf.isActive && bf.branchId != null) {
        offQuery = offQuery.eq('branch_id', bf.branchId);
      }
      await offQuery;

      // Then insert the new live banner
      const { error } = await supabase.from('banners').insert({
        ...payload,
        is_live: true,
        branch_id: bf.branchIdForWrite,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['live_banner'] }),
  });
}
