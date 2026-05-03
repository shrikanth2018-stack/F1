/**
 * 1stOne F1 — useStaffOrders
 *
 * Staff-facing order hooks:
 * - Fetch today's orders (all or by cycle)
 * - Mark order delivered / update status
 * - Offline-aware: queues mutations when offline
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../api/supabaseClient';
import { invalidateOrderQueries } from '../api/invalidateOrderQueries';
import { useStaffQueueStore } from '../store/staffQueueStore';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import { useFeatureFlag } from './useFeatureFlag';
import { useAuth } from './useAuth';
import type { Order, OrderStatus } from '../types';

// Blueprint Sec 5.3 — anti-spam filter.
// Push ONLY at critical milestones: Ready, Dispatched, Received at Hub, Delivered, Cancelled.
// "Preparing" and "On the Way" are intentionally omitted to avoid notification fatigue.
//
// Each entry pairs the event_key (for admin template lookup) with a hardcoded
// fallback used when the template row is missing. Admin can override text or
// disable any of these via the Notification Manager screen.
const STATUS_PUSH: Record<string, {
  event_key: string;
  title: string;
  body: (id: number) => string;
}> = {
  Ready:              { event_key: 'order.ready',           title: 'Order Ready!',    body: (id) => `Order #${id} is packed and ready for dispatch.` },
  Dispatched:         { event_key: 'order.dispatched',      title: 'On the Way!',     body: (id) => `Your order #${id} is on the way. Should arrive soon!` },
  'Received at Hub':  { event_key: 'order.received_at_hub', title: 'At Your Hub',     body: (id) => `Order #${id} has arrived at your pickup hub.` },
  Delivered:          { event_key: 'order.delivered',       title: 'Delivered!',      body: (id) => `Order #${id} delivered. Enjoy your meal!` },
  Cancelled:          { event_key: 'order.cancelled',       title: 'Order Cancelled', body: (id) => `Order #${id} has been cancelled.` },
};

/** Fetch today's orders for staff dashboard */
export function useStaffOrders(cycleId?: number) {
  const today = new Date().toISOString().split('T')[0];
  const bf = useBranchFilter();
  const hubDeliveryActive = useFeatureFlag('hub_delivery_active');
  const { session } = useAuth();
  const assignedHubId = session?.assignedHubId ?? null;

  return useQuery({
    queryKey: [
      ...QUERY_KEYS.STAFF_ORDERS,
      today,
      cycleId ?? 'all',
      bf.isActive ? bf.branchId ?? 'all' : 'off',
      hubDeliveryActive && assignedHubId != null ? assignedHubId : 'no-hub',
    ],
    queryFn: async () => {
      // Also pull the zone's + hub's driver_code so the Delivery tab can label each row.
      let query = supabase
        .from('orders')
        .select(`
          *,
          order_items(*),
          customer_addresses(*, delivery_zones(driver_code, zone_name), delivery_hubs(driver_code, hub_name))
        `)
        .eq('dispatch_date', today)
        .order('created_at', { ascending: false });

      if (cycleId) {
        query = query.eq('cycle_id', cycleId);
      }
      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }

      const { data, error } = await query;
      if (error) throw error;
      const orders = (data ?? []) as (Order & { order_items: any[]; customer_addresses: any })[];

      if (hubDeliveryActive && assignedHubId != null) {
        return orders.filter(
          (o) => (o.customer_addresses as any)?.hub_id === assignedHubId
        );
      }

      return orders;
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Update order status (offline-aware) + fire push to customer */
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  const enqueue = useStaffQueueStore((s) => s.enqueue);
  const { session } = useAuth();

  return useMutation({
    mutationFn: async ({
      orderId,
      status,
      userId,
    }: {
      orderId: number;
      status: OrderStatus;
      userId?: string;
    }) => {
      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected && netState.isInternetReachable !== false;

      if (isOnline) {
        const { error } = await supabase
          .from('orders')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', orderId);

        if (error) throw error;

        // Fire-and-forget push to the customer.
        // send-push resolves the template on the server side via event_key.
        // Fallback title/body are sent along so the push still works even if
        // the template row is missing. If admin disabled the event, server skips.
        const msg = STATUS_PUSH[status];
        if (msg && userId) {
          const { data: { session: raw } } = await supabase.auth.getSession();
          if (raw?.access_token) {
            supabase.functions.invoke('send-push', {
              headers: { Authorization: `Bearer ${raw.access_token}` },
              body: {
                user_ids: [userId],
                event_key: msg.event_key,
                vars: { order_id: orderId },
                title: msg.title,
                body: msg.body(orderId),
                data: { screen: 'OrderDetail', params: { orderId } },
                trigger_source: 'order_status',
                reference_id: String(orderId),
              },
            }).catch((e) => console.error('[push status]', e));
          }
        }
      } else {
        enqueue({
          userId: session?.user.id ?? '',
          table: 'orders',
          operation: 'update',
          payload: { status, updated_at: new Date().toISOString() },
          matchColumn: 'id',
          matchValue: orderId,
        });
      }
    },
    onSuccess: () => {
      invalidateOrderQueries(queryClient);
    },
  });
}
