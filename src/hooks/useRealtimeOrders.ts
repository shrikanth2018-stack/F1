/**
 * 1stOne F1 — useRealtimeOrders
 *
 * Subscribes to Supabase Realtime on the orders table.
 * When any INSERT or UPDATE arrives for today's orders,
 * invalidates the staff_orders React Query cache so the
 * kitchen / packing / delivery views refresh instantly.
 *
 * Mounted by StaffDashboard, AdminHome, HubDashboardScreen,
 * DriverDashboardScreen. Zero new queries — piggybacks on
 * the existing order-reading caches via invalidateOrderQueries.
 *
 * Auth attach: the Realtime client's JWT is kept current in
 * `useAuth` (onAuthStateChange + the initial getSession path).
 * No per-subscriber setAuth here — see CLAUDE.md.
 */

import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { invalidateOrderQueries } from '../api/invalidateOrderQueries';

/** Returns today's IST date as YYYY-MM-DD. DST-safe; never mid-day-rolls. */
function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/**
 * Milliseconds from `now` until the next IST midnight, plus a 5s margin.
 *
 * Implemented with UTC arithmetic. Do not use
 *   `new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))`
 * — Hermes returns Invalid Date for that format, the delay becomes NaN,
 * and `setTimeout(fn, NaN)` is coerced to 0, causing the rollover to fire
 * immediately and the hook to recurse into a tight subscribe loop. See
 * CLAUDE.md for the longer note.
 */
function msUntilNextIstMidnight(now: Date): number {
  const IST_OFFSET_MIN = 330; // IST = UTC+5:30
  const istWallMs = now.getTime() + IST_OFFSET_MIN * 60_000;
  const istWall = new Date(istWallMs);
  const nextIstMidnightUtcMs =
    Date.UTC(istWall.getUTCFullYear(), istWall.getUTCMonth(), istWall.getUTCDate() + 1)
    - IST_OFFSET_MIN * 60_000;
  return nextIstMidnightUtcMs + 5_000 - now.getTime();
}

export function useRealtimeOrders(enabled = true) {
  const queryClient = useQueryClient();
  // Alphanumeric per-mount suffix prevents channel-name collisions when
  // sibling screens or HMR mount the hook in the same render pass.
  // (React's useId() returns `:r4:` with colons, which historically
  // tripped Realtime topic parsers — kept off-limits here.)
  const instanceId = useMemo(() => Math.random().toString(36).slice(2, 10), []);

  useEffect(() => {
    if (!enabled) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let rolloverTimer: ReturnType<typeof setTimeout> | null = null;

    const subscribe = () => {
      const today = todayIST();
      channel = supabase
        .channel(`orders-realtime-${today}-${instanceId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `dispatch_date=eq.${today}`,
          },
          () => {
            // Invalidate every order-reading cache key so Staff / Hub /
            // Driver / Admin views all refetch off the same realtime tick.
            invalidateOrderQueries(queryClient);
          },
        )
        .subscribe();

      // Re-subscribe at next IST midnight (+ 5s margin) so a dashboard
      // left open across midnight starts receiving the new day's orders.
      // Critical for cross-midnight cycles (cutoff_time > delivery_start
      // in delivery_cycles) — those create orders with dispatch_date=tomorrow,
      // which today's channel filter wouldn't surface.
      rolloverTimer = setTimeout(() => {
        if (channel) supabase.removeChannel(channel);
        invalidateOrderQueries(queryClient);
        subscribe();
      }, msUntilNextIstMidnight(new Date()));
    };

    subscribe();

    return () => {
      if (rolloverTimer) clearTimeout(rolloverTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [enabled, queryClient, instanceId]);
}
