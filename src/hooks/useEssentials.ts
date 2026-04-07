/**
 * 1stOne F1 — useEssentials
 *
 * Essentials module hooks (feature-flagged):
 * - Fetch essentials catalog
 * - Place essentials order (via Edge Function)
 * - Works with essentialsCartStore
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
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

/** Place an essentials order */
export function usePlaceEssentialsOrder() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      items,
      addressId,
      paymentMethod,
      cycleId,
    }: {
      items: { item_id: number; item_name: string; quantity: number; price: number }[];
      addressId: number;
      paymentMethod: 'wallet' | 'razorpay';
      cycleId: number;
    }) => {
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('place-order', {
        body: {
          items,
          address_id: addressId,
          payment_method: paymentMethod,
          cycle_id: cycleId,
          order_type: 'essential',
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ORDERS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MY_ORDERS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
    },
  });
}
