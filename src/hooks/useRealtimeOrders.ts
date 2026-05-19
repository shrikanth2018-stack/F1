/**
 * 1stOne F1 — useRealtimeOrders
 *
 * Subscribes to Supabase Realtime on two tables:
 *  - orders          — any INSERT/UPDATE refreshes every order-reading
 *                      cache so kitchen / packing / hub / driver views
 *                      update instantly.
 *  - kitchen_push_log — an INSERT means a new cycle was pushed: the
 *                      active staff batch flips, so the batch lookup is
 *                      invalidated and the staff screens swing to the
 *                      new cycle (the previous cycle's orders drop off).
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
import { todayIST } from '../utils/istDate';

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
          { event: '*', schema: 'public', table: 'orders' },
          () => {
            // Invalidate every order-reading cache key so Staff / Hub /
            // Driver / Admin views all refetch off the same realtime tick.
            // No dispatch_date filter: the active batch's push_date can be
            // tomorrow (cross-midnight cycles); the staff queries scope to
            // the batch themselves, so catching every order change is right.
            invalidateOrderQueries(queryClient);
          },
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'kitchen_push_log' },
          () => {
            // A new cycle was pushed — the active staff batch flips.
            // Refetch the batch lookup so Kitchen / Packing / Hub / Driver
            // swing to the new cycle, then refetch the order lists for it.
            queryClient.invalidateQueries({ queryKey: ['active_staff_batch'] });
            invalidateOrderQueries(queryClient);
          },
        )
        .subscribe();

      // Re-subscribe at next IST midnight (+ 5s margin): a daily refresh of
      // the channel for a dashboard left open for days, plus an invalidation
      // so it recovers cleanly if the socket silently dropped overnight.
      rolloverTimer = setTimeout(() => {
        if (channel) supabase.removeChannel(channel);
        queryClient.invalidateQueries({ queryKey: ['active_staff_batch'] });
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
