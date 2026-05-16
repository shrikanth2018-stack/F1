/**
 * 1stOne F1 — useOrders
 *
 * Fetches customer order history and order detail.
 * useMyOrders uses infinite-scroll pagination (20 orders per page).
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { invalidateOrderQueries } from '../api/invalidateOrderQueries';
import { QUERY_KEYS } from '../utils/constants';
import { useAuth } from './useAuth';
import type { Order, OrderItem } from '../types';

const PAGE_SIZE = 20;

export function useMyOrders() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  return useInfiniteQuery({
    queryKey: [...QUERY_KEYS.MY_ORDERS],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);
      if (error) throw error;
      return (data ?? []) as Order[];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage: Order[], allPages: Order[][]) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.reduce((sum, page) => sum + page.length, 0);
    },
    enabled: !!userId,
  });
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
    mutationFn: async (payload: { order_id: number }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('cancel-order', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { order_id: payload.order_id },
      });

      if (error) {
        let message = 'Cancellation failed';
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx === 'object' && ctx.error) message = ctx.error;
        throw new Error(message);
      }

      return data;
    },
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('confirm-order', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: payload,
      });

      if (error) throw new Error('Payment confirmation failed');
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
