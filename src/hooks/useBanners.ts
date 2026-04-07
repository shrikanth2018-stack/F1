/**
 * 1stOne F1 — useBanners
 *
 * Fetches live banners for the home screen carousel.
 * Schema uses is_live (not is_active) for banners.
 */

import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import type { Banner } from '../types';

export function useBanners() {
  return useSupabaseQuery<Banner>(QUERY_KEYS.BANNERS, 'banners', {
    select: '*',
    filter: (query) =>
      query.eq('is_live', true).order('created_at', { ascending: false }),
  });
}
