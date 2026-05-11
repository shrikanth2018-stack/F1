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

/** Returns today's IST date as YYYY-MM-DD. DST-safe; never mid-day-rolls. */
function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function useRealtimeOrders(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    // BF-38b (F4.3): rebuild subscription at midnight so a dashboard left
    // open overnight starts receiving the new day's orders. Without this,
    // `today` was captured once at mount and the filter pointed at the
    // previous day forever.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let rolloverTimer: ReturnType<typeof setTimeout> | null = null;

    const subscribe = () => {
      const today = todayIST();
      channel = supabase
        .channel(`staff-orders-realtime-${today}`)
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
          },
        )
        .subscribe();

      // Schedule re-subscribe at next IST midnight (+ a 5s safety margin).
      const now = new Date();
      const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const istMidnight = new Date(istNow);
      istMidnight.setHours(24, 0, 5, 0);
      const msUntilMidnight = istMidnight.getTime() - istNow.getTime();
      rolloverTimer = setTimeout(() => {
        if (channel) supabase.removeChannel(channel);
        // Also invalidate so the React Query cache resets to today's data.
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_ORDERS });
        subscribe();
      }, msUntilMidnight);
    };

    subscribe();

    return () => {
      if (rolloverTimer) clearTimeout(rolloverTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
