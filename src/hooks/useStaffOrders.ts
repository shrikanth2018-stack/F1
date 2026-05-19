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
import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { invalidateOrderQueries } from '../api/invalidateOrderQueries';
import { useStaffQueueStore } from '../store/staffQueueStore';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import { useFeatureFlag } from './useFeatureFlag';
import { useAuth } from './useAuth';
import { useActiveStaffBatch } from './useActiveStaffBatch';
import { isOperationalOrder } from '../utils/orderFilters';
import { todayIST } from '../utils/istDate';
import { fireOrderStatusPush } from '../utils/orderStatusPush';
import type { Order, OrderStatus } from '../types';

/**
 * Orders for the staff operational screens (Kitchen / Packing / Hub).
 *
 * Scoped to the ACTIVE BATCH — the single cycle released by the most recent
 * kitchen push (useActiveStaffBatch). Orders reach the staff screens ONLY
 * via the push; the board shows exactly one cycle's batch and flips to the
 * next cycle when that cycle pushes. Returns [] until the first push.
 */
export function useStaffOrders() {
  const bf = useBranchFilter();
  const hubDeliveryActive = useFeatureFlag('hub_delivery_active');
  const { session } = useAuth();
  const assignedHubId = session?.assignedHubId ?? null;
  const { data: batch } = useActiveStaffBatch();
  // IST calendar date — the basis for the D2 "unsuccessful delivery" cut-off.
  const today = todayIST();

  return useQuery({
    queryKey: [
      ...QUERY_KEYS.STAFF_ORDERS,
      batch ? `${batch.cycle_id}:${batch.push_date}` : 'none',
      bf.isActive ? bf.branchId ?? 'all' : 'off',
      hubDeliveryActive && assignedHubId != null ? assignedHubId : 'no-hub',
      today,
    ],
    queryFn: async () => {
      // The list = the active batch's cycle, PLUS any "unsuccessful delivery"
      // — a past-dated order still not Delivered/Cancelled/Failed. D2: the
      // batch flip must not hide an undelivered perishable order.
      const unsuccessful =
        `and(dispatch_date.lt.${today},status.not.in.(Delivered,Cancelled,Failed))`;

      // Pull the zone's + hub's driver_code so the Delivery tab can label each row.
      let query = supabase
        .from('orders')
        .select(`
          *,
          order_items(*),
          customer_addresses(*, delivery_zones(driver_code, zone_name), delivery_hubs(driver_code, hub_name)),
          profiles(phone_number)
        `)
        .order('created_at', { ascending: false });

      if (batch) {
        // Active batch (one cycle + its push_date, Cancelled excluded) OR
        // any unsuccessful-delivery order.
        const active =
          `and(cycle_id.eq.${batch.cycle_id},dispatch_date.eq.${batch.push_date},status.neq.Cancelled)`;
        query = query.or(`${active},${unsuccessful}`);
      } else {
        // No cycle pushed yet — staff still see any unsuccessful-delivery order.
        query = query.or(unsuccessful);
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
    // Wait until the active-batch lookup resolves (to a cycle or to null).
    enabled: batch !== undefined,
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

export interface KitchenAggregateItem {
  item_name: string;
  /** Unit suffix ("g", "ml", "") — blank means an integer count. */
  unit: string;
  total_quantity: number;
  status: OrderStatus;
  order_ids: number[];
}

/**
 * Kitchen prep aggregation — server-derived (audit D5). The
 * get_kitchen_aggregate RPC breaks the active staff batch's food orders
 * into ingredient components; the device only renders the result. Its
 * query key sits under STAFF_ORDERS so realtime order changes invalidate it.
 */
export function useKitchenAggregate() {
  const { data: batch } = useActiveStaffBatch();
  return useSupabaseQuery<KitchenAggregateItem>(
    [...QUERY_KEYS.STAFF_ORDERS, 'kitchen', batch ? `${batch.cycle_id}:${batch.push_date}` : 'none'],
    () =>
      // RPC post-dates the generated types — cast (MF-08 pattern).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc('get_kitchen_aggregate', {
        p_cycle_id: batch?.cycle_id,
        p_dispatch_date: batch?.push_date,
      }),
    { enabled: batch != null, staleTime: QUERY_STALE_TIME },
  );
}

/**
 * Bulk-advance many orders to one status in a single transaction via the
 * advance_orders_status RPC (audit D6) — replaces a loop of N single
 * mutations. The RPC fans out the customer 'Ready' push server-side.
 */
export function useBulkAdvanceStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderIds, status }: { orderIds: number[]; status: OrderStatus }) => {
      if (orderIds.length === 0) return 0;
      // RPC post-dates the generated types — cast (MF-08 pattern).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('advance_orders_status', {
        p_order_ids: orderIds,
        p_status: status,
      });
      if (error) throw new Error(error.message);
      return (data as number) ?? 0;
    },
    onSuccess: () => {
      invalidateOrderQueries(queryClient);
    },
  });
}
