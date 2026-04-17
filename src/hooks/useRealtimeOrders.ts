/**
 * 1stOne F1 — useRealtimeOrders
 *
 * Subscribes to Supabase Realtime on the orders table.
 * When any INSERT or UPDATE arrives for today's orders,
 * invalidates the staff_orders React Query cache so the
 * kitchen / packing / delivery views refresh instantly.
 *
 * Designed to be called once inside StaffDashboard.
 * Zero new queries — piggybacks on the existing useStaffOrders cache.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS } from '../utils/constants';

export function useRealtimeOrders(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const today = new Date().toISOString().split('T')[0];

    const channel = supabase
      .channel('staff-orders-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `dispatch_date=eq.${today}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_ORDERS });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
