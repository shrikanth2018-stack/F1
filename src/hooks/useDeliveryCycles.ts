/**
 * 1stOne F1 — useDeliveryCycles
 *
 * Fetches active delivery cycles from Supabase.
 * Returns cycles sorted by sort_order.
 */

import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import type { DeliveryCycle } from '../types';

export function useDeliveryCycles() {
  return useSupabaseQuery<DeliveryCycle>(
    QUERY_KEYS.DELIVERY_CYCLES,
    'delivery_cycles',
    {
      select: '*',
      filter: (query) => query.eq('is_active', true).order('sort_order'),
    }
  );
}
