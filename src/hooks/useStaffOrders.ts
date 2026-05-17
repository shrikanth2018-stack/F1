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
import { isOperationalOrder } from '../utils/orderFilters';
import { fireOrderStatusPush } from '../utils/orderStatusPush';
import type { Order, OrderStatus } from '../types';

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
          customer_addresses(*, delivery_zones(driver_code, zone_name), delivery_hubs(driver_code, hub_name)),
          profiles(phone_number)
        `)
        // Cancelled orders never belong on operational staff/hub screens —
        // they live only in order history (customer profile + admin). Excluded
        // at the query so Kitchen, Packing and Hub Today are all clean by default.
        .eq('dispatch_date', today)
        .neq('status', 'Cancelled')
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

      // Subscription-purchase orders carry only item_type='subscription' rows
      // (revenue record + activation). Daily dispatch rows have real food /
      // essential items from plan_items and pass isOperationalOrder.
      const operational = orders.filter(isOperationalOrder);

      if (hubDeliveryActive && assignedHubId != null) {
        return operational.filter(
          (o) => (o.customer_addresses as any)?.hub_id === assignedHubId
        );
      }

      return operational;
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

        // Fire-and-forget customer push — shared helper resolves the template
        // (admin's editable copy) and skips non-milestone statuses.
        fireOrderStatusPush(orderId, status, userId);
      } else {
        enqueue({
          userId: session?.user.id ?? '',
          table: 'orders',
          operation: 'update',
          payload: { status, updated_at: new Date().toISOString() },
          matchColumn: 'id',
          matchValue: orderId,
          // Customer to push once this status update syncs (see useOfflineSync).
          notifyUserId: userId ?? null,
        });
      }
    },
    onSuccess: () => {
      invalidateOrderQueries(queryClient);
    },
  });
}
