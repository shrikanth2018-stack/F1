/**
 * 1stOne F1 — useRealtimeOrders
 *
 * Supabase Realtime subscription for order status changes.
 * Staff/Admin ONLY — customers use pull-to-refresh (per blueprint).
 *
 * Listens to INSERT and UPDATE on orders table,
 * invalidates TanStack Query cache on change.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS } from '../utils/constants';

export function useRealtimeOrders(enabled: boolean = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
        },
        () => {
          // Invalidate all order-related queries
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ORDERS });
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_ORDERS });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
