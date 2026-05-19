/**
 * 1stOne F1 — useOrders
 *
 * Fetches customer order history and order detail.
 * useMyOrders uses infinite-scroll pagination (20 orders per page).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { invokeFunction } from '../api/invokeFunction';
import { useSupabaseQuery, useSupabaseMutation, useSupabaseInfiniteQuery } from '../api/useSupabaseQuery';
import { invalidateOrderQueries } from '../api/invalidateOrderQueries';
import { QUERY_KEYS } from '../utils/constants';
import { useAuth } from './useAuth';
import type { Order, OrderItem } from '../types';

const PAGE_SIZE = 20;

export function useMyOrders() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  return useSupabaseInfiniteQuery<Order>(
    [...QUERY_KEYS.MY_ORDERS],
    (offset) =>
      supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
    { pageSize: PAGE_SIZE, enabled: !!userId },
  );
}

export function useOrderDetail(orderId: number) {
  return useSupabaseQuery<Order>(
    [...QUERY_KEYS.ORDERS, orderId],
    () =>
      supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .limit(1),
  );
}

export type OrderWithItems = Order & { order_items: OrderItem[] };

/**
 * MF-10: a customer-facing "order" can be a GROUP of `orders` rows —
 * one per dispatch cycle, all sharing order_group_id. Given any row id,
 * this resolves the whole group and returns every row with its items,
 * sorted by dispatch date. OrderDetail renders one section per row.
 */
export function useOrderGroup(orderId: number) {
  return useQuery({
    queryKey: [...QUERY_KEYS.ORDERS, 'group', orderId],
    queryFn: async (): Promise<OrderWithItems[]> => {
      const { data: anchor, error: anchorErr } = await supabase
        .from('orders')
        .select('order_group_id')
        .eq('id', orderId)
        .maybeSingle();
      if (anchorErr) throw anchorErr;
      if (!anchor) throw new Error('Order not found');

      const { data: rows, error: rowsErr } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('order_group_id', anchor.order_group_id)
        .order('dispatch_date', { ascending: true })
        .order('id', { ascending: true });
      if (rowsErr) throw rowsErr;
      return (rows ?? []) as OrderWithItems[];
    },
    enabled: !!orderId,
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { order_id: number }) =>
      invokeFunction('cancel-order', { order_id: payload.order_id }, {
        fallbackMessage: 'Cancellation failed',
      }),
    onSuccess: () => {
      invalidateOrderQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
    },
  });
}

export function useConfirmOrder() {
  return useSupabaseMutation<{
    order_id: number;
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }>(
    async (payload) => {
      const data = await invokeFunction('confirm-order', payload, {
        fallbackMessage: 'Payment confirmation failed',
      });
      return { data, error: null, count: null, status: 200, statusText: 'OK' } as any;
    },
    [QUERY_KEYS.MY_ORDERS as unknown as string[], QUERY_KEYS.ORDERS as unknown as string[]]
  );
}

// Polls for any Razorpay order stuck in Pending within the last 2 hours.
// Auto-clears when the webhook flips it to Paid/Failed.
export function usePendingRazorpayOrder() {
  const { session } = useAuth();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  return useSupabaseQuery<Order>(
    [...QUERY_KEYS.MY_ORDERS, 'pending_razorpay'],
    () =>
      supabase
        .from('orders')
        .select('*')
        .eq('user_id', session?.user.id ?? '')
        .eq('status', 'Pending')
        .eq('payment_method', 'razorpay')
        .gte('created_at', twoHoursAgo)
        .order('created_at', { ascending: false })
        .limit(1),
    {
      enabled: !!session?.user.id,
      refetchInterval: 15_000,
    }
  );
}
