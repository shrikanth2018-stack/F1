/**
 * 1stOne F1 — useHubOrderHistory
 *
 * Read-only history of the last 100 orders for the current hub operator's
 * assigned hub. Includes all statuses (Delivered, Cancelled, plus stale
 * actives that never reached terminal). RLS auto-scopes: the hub op only
 * has SELECT visibility on orders whose customer_address.hub_id matches
 * their assigned_hub_id.
 *
 * Used only by HubDashboardScreen's History tab.
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { useAuth } from './useAuth';
// Never `toISOString()` for a business date — between 00:00 and 05:30 IST it
// gives yesterday, which here would hide a delivery the hub actually handled.
import { todayIST } from '../utils/istDate';

const HISTORY_LIMIT = 100;

export function useHubOrderHistory() {
  const { session } = useAuth();
  const assignedHubId = session?.assignedHubId ?? null;

  return useSupabaseQuery(
    ['hub_order_history', assignedHubId],
    () =>
      supabase
        .from('orders')
        .select(`
          *,
          order_items(*),
          customer_addresses(*, delivery_zones(driver_code, zone_name), delivery_hubs(driver_code, hub_name)),
          profiles(phone_number)
        `)
        /**
         * HISTORY IS THE PAST. Nothing here bounded the date, so a bulk order
         * an admin created for a FUTURE day — routed to this hub, status
         * Confirmed — sat in "History" before it had happened. Reported
         * 13 Aug against orders #11658/9 and #11667, all dispatch 14 Aug.
         *
         * A future order now appears on no hub screen until its batch is
         * released, which is what every other board already does: the Today
         * board is scoped to the cycle the kitchen push let out, and nothing
         * reaches an operator earlier than that.
         */
        .lte('dispatch_date', todayIST())
        .order('dispatch_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT),
    {
      enabled: assignedHubId != null,
      staleTime: 30_000,
      // Narrow to the operator's exact hub via the joined address — can't
      // .eq through an embedded relation. RLS already enforces visibility.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform: (rows: any[]) =>
        rows.filter((o) => (o.customer_addresses as any)?.hub_id === assignedHubId),
    },
  );
}
