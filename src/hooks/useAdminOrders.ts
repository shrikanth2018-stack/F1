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
import { invalidateOrderQueries } from '../api/invalidateOrderQueries';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { OrderStatus } from '../types';

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

const STATUS_PUSH: Record<string, { title: string; body: (id: number) => string }> = {
  Confirmed:          { title: 'Order Confirmed!',  body: (id) => `Your order #${id} is confirmed. We are getting it ready!` },
  Preparing:          { title: 'In the Kitchen',    body: (id) => `Order #${id} is being prepared now.` },
  Ready:              { title: 'Order Ready!',       body: (id) => `Order #${id} is packed and ready for dispatch.` },
  Dispatched:         { title: 'On the Way!',        body: (id) => `Your order #${id} is on the way. Should arrive soon!` },
  'On the Way':       { title: 'On the Way!',        body: (id) => `Your order #${id} is on the way. Should arrive soon!` },
  'Received at Hub':  { title: 'At Your Hub',        body: (id) => `Order #${id} has arrived at your pickup hub.` },
  Delivered:          { title: 'Delivered!',          body: (id) => `Order #${id} delivered. Enjoy your meal!` },
  Cancelled:          { title: 'Order Cancelled',    body: (id) => `Order #${id} has been cancelled.` },
};

async function firePush(orderId: number, status: string, userId: string) {
  const msg = STATUS_PUSH[status];
  if (!msg) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return;
  supabase.functions.invoke('send-push', {
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: {
      user_ids: [userId],
      title: msg.title,
      body: msg.body(orderId),
      data: { screen: 'OrderDetail', params: { orderId }, trigger_source: 'order_status' },
      trigger_source: 'order_status',
      reference_id: String(orderId),
    },
  }).catch((e) => console.error('[push admin]', e));
}

/**
 * BF-34a (F3.1, 2026-05-11): atomic admin order cancel + wallet refund.
 *
 * Calls admin_cancel_order_atomic RPC which deactivates the order
 * (with APPENDED notes preserving prior delivery instructions) and
 * credits the wallet in a single Postgres transaction. Replaces the
 * previous two-step flow that risked "cancelled but unrefunded" on a
 * mid-flow network failure. Mirrors BF-20's pattern for subscriptions.
 */
export function useAdminCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orderId,
      walletAmountUsed,
      userId,
      reason,
    }: {
      orderId: number;
      walletAmountUsed: number;
      userId: string;
      reason?: string;
    }) => {
      // RPC name cast: database.types.ts is auto-generated and won't
      // know about this RPC until regenerated. Same pattern as
      // admin_cancel_subscription_atomic in useSubscriptions.ts.
      const { error } = await supabase.rpc('admin_cancel_order_atomic' as never, {
        p_order_id:      orderId,
        p_refund_amount: walletAmountUsed,
        p_reason:        reason ?? 'Cancelled by admin',
      } as never);
      if (error) throw new Error(error.message);

      firePush(orderId, 'Cancelled', userId);
    },
    onSuccess: () => {
      invalidateOrderQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
    },
  });
}
