/**
 * 1stOne F1 — useAdminOrders
 *
 * Admin-facing order hooks:
 * - All orders with filters (date range, status, cycle)
 * - Update any order status
 * - Cancel order
 * Realtime via useRealtimeOrders.
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { Order, OrderStatus } from '../types';

interface AdminOrderFilters {
  date?: string;         // YYYY-MM-DD, defaults to today
  status?: OrderStatus;
  cycleId?: number;
}

/** Fetch all orders with optional filters */
export function useAdminOrders(filters: AdminOrderFilters = {}) {
  const date = filters.date ?? new Date().toISOString().split('T')[0];
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['admin_orders', date, filters.status, filters.cycleId, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('*, order_items(*), customer_addresses(*), profiles!orders_user_id_fkey(full_name, phone_number)')
        .eq('dispatch_date', date)
        .order('created_at', { ascending: false });

      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.cycleId) {
        query = query.eq('cycle_id', filters.cycleId);
      }
      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Admin: update any order's status */
export function useAdminUpdateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orderId,
      status,
      notes,
    }: {
      orderId: number;
      status: OrderStatus;
      notes?: string;
    }) => {
      const update: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
      };
      if (notes !== undefined) update.notes = notes;

      const { error } = await supabase
        .from('orders')
        .update(update)
        .eq('id', orderId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ORDERS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_ORDERS });
      queryClient.invalidateQueries({ queryKey: ['admin_orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin_stats'] });
    },
  });
}

/** Admin: cancel order */
export function useAdminCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderId, reason }: { orderId: number; reason?: string }) => {
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'Cancelled' as OrderStatus,
          notes: reason ?? 'Cancelled by admin',
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ORDERS });
      queryClient.invalidateQueries({ queryKey: ['admin_orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin_stats'] });
    },
  });
}
