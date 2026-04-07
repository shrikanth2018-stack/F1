/**
 * 1stOne F1 — useMenuItems
 *
 * Fetches menu items, optionally filtered by delivery cycle.
 * Returns only available (is_available = true) items.
 */

import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import type { MenuItem } from '../types';

export function useMenuItems(cycleId?: number | null) {
  const queryKey = cycleId
    ? [...QUERY_KEYS.MENU_ITEMS, cycleId]
    : QUERY_KEYS.MENU_ITEMS;

  return useSupabaseQuery<MenuItem>(queryKey, 'menu_items', {
    select: '*',
    filter: (query) => {
      let q = query.eq('is_available', true).order('display_order');
      if (cycleId) {
        q = q.eq('cycle_id', cycleId);
      }
      return q;
    },
  });
}
