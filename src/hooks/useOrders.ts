/**
 * 1stOne F1 — useOrders
 *
 * Fetches customer order history and order detail.
 * useMyOrders uses infinite-scroll pagination (20 orders per page).
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { invalidateOrderQueries } from '../api/invalidateOrderQueries';
import { QUERY_KEYS } from '../utils/constants';
import { useAuth } from './useAuth';
import type { Order } from '../types';

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
