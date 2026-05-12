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

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';

const HISTORY_LIMIT = 100;

export function useHubOrderHistory() {
  const { session } = useAuth();
  const assignedHubId = session?.assignedHubId ?? null;

  return useQuery({
    queryKey: ['hub_order_history', assignedHubId],
    queryFn: async () => {
      if (assignedHubId == null) return [];

      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items(*),
          customer_addresses(*, delivery_zones(driver_code, zone_name), delivery_hubs(driver_code, hub_name)),
          profiles(phone_number)
        `)
        .order('dispatch_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);

      if (error) throw error;

      // Filter to the operator's hub via the joined address. We can't .eq
      // through the embedded relation, so we filter client-side. RLS still
      // enforces the visibility contract — this is just for narrowing the
      // already-scoped result set down to the operator's exact hub.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).filter((o: any) => (o.customer_addresses as any)?.hub_id === assignedHubId);
    },
    enabled: assignedHubId != null,
    staleTime: 30_000,
  });
}
