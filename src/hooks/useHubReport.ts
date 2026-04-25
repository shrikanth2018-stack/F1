/**
 * 1stOne F1 — useHubReport
 *
 * Hub-level delivery analytics for the admin Hub Report screen.
 * Queries orders joined with customer_addresses to group by hub.
 *
 * Returns per-hub stats:
 *   - Orders count by status bucket
 *   - Revenue total
 *   - Delivery performance (delivered / total active)
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useBranchFilter } from './useBranchFilter';

export interface HubStat {
  hub_id: number;
  hub_name: string;
  total_orders: number;
  dispatched: number;
  received_at_hub: number;
  on_the_way: number;
  delivered: number;
  pending: number;       // Confirmed + Preparing + Ready + Packed
  cancelled: number;
  revenue: number;
  /** Commission % set on the hub (null = no commission contract). */
  commission_percent: number | null;
  /** Computed: sum(delivered order total × commission_percent / 100). */
  commission_due: number;
}

export function useHubReport(startDate: string, endDate: string) {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['report_hub', startDate, endDate, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      // Fetch hub-delivery orders with address hub_id in the date range.
      // Pull commission_percent from the joined hub so we can compute payout due.
      let query = supabase
        .from('orders')
        .select(`
          id,
          total_amount,
          status,
          delivery_method,
          hub_id,
          dispatch_date,
          branch_id,
          delivery_hubs!orders_hub_id_fkey(hub_name, commission_percent)
        `)
        .eq('delivery_method', 'hub')
        .gte('dispatch_date', startDate)
        .lte('dispatch_date', endDate)
        .order('dispatch_date', { ascending: false });

      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const orders = (data ?? []) as any[];

      // Aggregate per hub
      const hubMap = new Map<number, HubStat>();

      for (const o of orders) {
        const hid: number = o.hub_id;
        if (hid == null) continue;

        if (!hubMap.has(hid)) {
          hubMap.set(hid, {
            hub_id: hid,
            hub_name: o.delivery_hubs?.hub_name ?? `Hub #${hid}`,
            total_orders: 0,
            dispatched: 0,
            received_at_hub: 0,
            on_the_way: 0,
            delivered: 0,
            pending: 0,
            cancelled: 0,
            revenue: 0,
            commission_percent: o.delivery_hubs?.commission_percent ?? null,
            commission_due: 0,
          });
        }

        const stat = hubMap.get(hid)!;
        stat.total_orders += 1;
        stat.revenue += o.total_amount ?? 0;

        // Only delivered orders count toward commission payout.
        if (o.status === 'Delivered' && stat.commission_percent != null) {
          stat.commission_due += (o.total_amount ?? 0) * (stat.commission_percent / 100);
        }

        switch (o.status) {
          case 'Dispatched':       stat.dispatched += 1; break;
          case 'Received at Hub':  stat.received_at_hub += 1; break;
          case 'On the Way':       stat.on_the_way += 1; break;
          case 'Delivered':        stat.delivered += 1; break;
          case 'Cancelled':        stat.cancelled += 1; break;
          default:                 stat.pending += 1; break;
        }
      }

      const stats = Array.from(hubMap.values()).sort((a, b) =>
        b.total_orders - a.total_orders
      );

      const totals = stats.reduce(
        (acc, s) => ({
          total_orders: acc.total_orders + s.total_orders,
          delivered: acc.delivered + s.delivered,
          revenue: acc.revenue + s.revenue,
          pending: acc.pending + s.pending,
        }),
        { total_orders: 0, delivered: 0, revenue: 0, pending: 0 }
      );

      return { hubs: stats, totals };
    },
    staleTime: 5 * 60 * 1000,
  });
}
