/**
 * 1stOne F1 — useStaffOrders
 *
 * Staff-facing order hooks:
 * - Fetch today's orders (all or by cycle)
 * - Mark order delivered / update status
 * - Offline-aware: queues mutations when offline
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../api/supabaseClient';
import { useStaffQueueStore } from '../store/staffQueueStore';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { Order, OrderStatus } from '../types';

/** Fetch today's orders for staff dashboard */
export function useStaffOrders(cycleId?: number) {
  const today = new Date().toISOString().split('T')[0];

  return useQuery({
    queryKey: [...QUERY_KEYS.STAFF_ORDERS, today, cycleId ?? 'all'],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('*, order_items(*), customer_addresses(*)')
        .eq('dispatch_date', today)
        .order('created_at', { ascending: false });

      if (cycleId) {
        query = query.eq('cycle_id', cycleId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as (Order & { order_items: any[]; customer_addresses: any })[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Update order status (offline-aware) */
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  const enqueue = useStaffQueueStore((s) => s.enqueue);

  return useMutation({
    mutationFn: async ({
      orderId,
      status,
    }: {
      orderId: number;
      status: OrderStatus;
    }) => {
      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected && netState.isInternetReachable !== false;

      if (isOnline) {
        const { error } = await supabase
          .from('orders')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', orderId);

        if (error) throw error;
      } else {
        enqueue({
          table: 'orders',
          operation: 'update',
          payload: { status, updated_at: new Date().toISOString() },
          matchColumn: 'id',
          matchValue: orderId,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_ORDERS });
    },
  });
}

/** Mark single order as Delivered (convenience wrapper) */
export function useMarkDelivered() {
  const updateStatus = useUpdateOrderStatus();

  return useMutation({
    mutationFn: async (orderId: number) => {
      return updateStatus.mutateAsync({ orderId, status: 'Delivered' });
    },
  });
}

/** Batch mark multiple orders as Delivered */
export function useBatchMarkDelivered() {
  const queryClient = useQueryClient();
  const enqueue = useStaffQueueStore((s) => s.enqueue);

  return useMutation({
    mutationFn: async (orderIds: number[]) => {
      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected && netState.isInternetReachable !== false;

      if (isOnline) {
        const { error } = await supabase
          .from('orders')
          .update({ status: 'Delivered' as OrderStatus, updated_at: new Date().toISOString() })
          .in('id', orderIds);

        if (error) throw error;
      } else {
        // Queue each individually for offline replay
        for (const orderId of orderIds) {
          enqueue({
            table: 'orders',
            operation: 'update',
            payload: { status: 'Delivered', updated_at: new Date().toISOString() },
            matchColumn: 'id',
            matchValue: orderId,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_ORDERS });
    },
  });
}
