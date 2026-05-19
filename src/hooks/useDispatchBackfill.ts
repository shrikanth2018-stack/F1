/**
 * 1stOne F1 — useDispatchBackfill
 *
 * Admin tool (audit O2). Runs `generate_daily_manifest` once per date across
 * a range via the `backfill_dispatch_manifest` RPC — the catch-up path when
 * subscription dispatch missed days (e.g. the C1 outage).
 *
 * The RPC is admin-gated and idempotent (an already-dispatched date is a
 * no-op) and capped at 31 days per call.
 */

import { useSupabaseMutation } from '../api/useSupabaseQuery';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS } from '../utils/constants';

export interface BackfillResult {
  days_processed: number;
  total_orders_created: number;
  per_day: { date: string; orders_created: number }[];
}

/** Backfill subscription dispatch for [start, end] (inclusive, YYYY-MM-DD). */
export function useDispatchBackfill() {
  return useSupabaseMutation<{ start: string; end: string }, BackfillResult>(
    ({ start, end }) =>
      // backfill_dispatch_manifest exists in the live DB but post-dates the
      // generated Supabase types (MF-08 pattern) — cast the RPC name.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.rpc('backfill_dispatch_manifest' as any, {
        p_start_date: start,
        p_end_date: end,
      }),
    // Backfill creates orders — refresh the staff batch board + admin orders.
    [QUERY_KEYS.STAFF_ORDERS, ['admin_orders_manage']],
  );
}
