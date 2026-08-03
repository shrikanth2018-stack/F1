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

import { supabase } from '../api/supabaseClient';
import { useSupabaseSingle, useSupabaseMutation } from '../api/useSupabaseQuery';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter, requireWriteBranch } from './useBranchFilter';
import type { Banner } from '../types';

// A `type`, not an `interface`, on purpose: only type aliases get an implicit
// index signature, and `resolveLayout` takes whole banner records — including
// old ones carrying none of the presentation keys.
export type CustomBannerContent = {
  title: string;
  subtitle?: string;
  bg_color: string;
  text_color: string;
  emoji?: string;
  pulse?: boolean;
  /**
   * Presentation, all optional. A banner saved before these existed resolves
   * to the previous look (panel / medium / bottom-centre) via
   * `resolveLayout`, so nothing live changes shape until it is edited.
   *
   *   style   'panel' tinted card, or 'scrim' text straight on the photo
   *   size    'S' | 'M' | 'L' — presets, so the hero cannot be broken
   *   align_h / align_v  where the text sits, to work around the photo
   */
  style?: 'panel' | 'scrim';
  size?: 'S' | 'M' | 'L';
  align_h?: 'left' | 'center' | 'right';
  align_v?: 'top' | 'middle' | 'bottom';
};

export function useLiveBanner() {
  const bf = useBranchFilter();

  return useSupabaseSingle<Banner>(
    ['live_banner', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let query = supabase
        .from('banners')
        .select('*')
        .eq('is_live', true)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }
      return query.maybeSingle();
    },
    { staleTime: QUERY_STALE_TIME },
  );
}

export function useUpsertBanner() {
  const bf = useBranchFilter();

  return useSupabaseMutation<Pick<Banner, 'banner_type' | 'image_url' | 'text_content' | 'is_live'>>(
    async (payload) => {
      // First set all existing banners to not live (scoped to branch if
      // applicable) — best-effort, same as before.
      let offQuery = supabase.from('banners').update({ is_live: false }).neq('id', 0);
      if (bf.isActive && bf.branchId != null) {
        offQuery = offQuery.eq('branch_id', bf.branchId);
      }
      await offQuery;

      // Then insert the new live banner — its error + invalidation run through
      // the shared layer. (An async return of a Supabase builder is flattened,
      // so useSupabaseMutation receives the resolved { data, error }.)
      return supabase.from('banners').insert({
        ...payload,
        is_live: true,
        branch_id: requireWriteBranch(bf),
      });
    },
    [['live_banner']],
  );
}
