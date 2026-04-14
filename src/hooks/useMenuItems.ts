/**
 * 1stOne F1 — useMenuItems
 *
 * Fetches active menu items filtered by the given cycle IDs.
 * Pass cycle IDs from useDeliveryCycles to scope the query server-side
 * and avoid unbounded growth as historical cycles accumulate.
 * Query is disabled until cycleIds are known.
 */

import { useMemo } from 'react';
import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import type { MenuItem } from '../types';

export function useMenuItems(cycleIds?: number[]) {
  // Memoize sort+spread so it doesn't allocate on every render
  const sortedIds = useMemo(
    () => (cycleIds?.length ? [...cycleIds].sort((a, b) => a - b) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cycleIds?.join(',')]
  );

  const queryKey = sortedIds
    ? [...QUERY_KEYS.MENU_ITEMS, ...sortedIds]
    : QUERY_KEYS.MENU_ITEMS;

  return useSupabaseQuery<MenuItem>(queryKey, 'menu_items', {
    select: '*',
    filter: (query) => {
      let q = query.eq('is_active', true).order('sort_order');
      if (sortedIds) {
        q = q.in('cycle_id', sortedIds);
      }
      return q;
    },
  }, {
    enabled: sortedIds !== undefined,
  });
}
