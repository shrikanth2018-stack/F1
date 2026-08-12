/**
 * 1stOne F1 — useOrders
 *
 * Fetches customer order history and order detail.
 * useMyOrders uses infinite-scroll pagination (20 orders per page).
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { invokeFunction } from '../api/invokeFunction';
import { useSupabaseQuery, useSupabaseMutation, useSupabaseInfiniteQuery } from '../api/useSupabaseQuery';
import { invalidateOrderQueries } from '../api/invalidateOrderQueries';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useAuth } from './useAuth';
import type { Order, OrderItem } from '../types';

const PAGE_SIZE = 20;

export type OrderWithItems = Order & { order_items: OrderItem[] };

export function useMyOrders() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  // Items come with the rows: the list shows what is in each delivery, so the
  // customer can tell two cards apart without opening either.
  return useSupabaseInfiniteQuery<OrderWithItems>(
    [...QUERY_KEYS.MY_ORDERS],
    (offset) =>
      supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
    { pageSize: PAGE_SIZE, enabled: !!userId },
  );
}


/**
 * What state each of the customer's unfinished orders is in — server-decided.
 *
 *   live              on its way; the batch is current or not yet released
 *   undelivered       the batch that carried it has been replaced and nobody
 *                     delivered it
 *   awaiting_payment  a card checkout started and never completed
 *
 * THE RULE IS NOT WRITTEN HERE, ON PURPOSE. "Undelivered" is decided by
 * `my_order_states()`, which shares one predicate with
 * `admin_undelivered_order_ids()` (see supabase/sql/customer_order_states.sql).
 * The admin's Undelivered tab and the customer's screens therefore cannot
 * disagree about which orders were lost — there is only one thing to change.
 *
 * Deriving it also means NOTHING writes a new `orders.status`: the row keeps
 * the status it actually stalled at, which is what staff and admin need in
 * order to fix it, while the customer reads the word "Undelivered".
 */
export type OrderState = 'live' | 'undelivered' | 'awaiting_payment';

export function useMyOrderStates() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  return useQuery({
    // Under the MY_ORDERS prefix so invalidateOrderQueries (which invalidates
    // ['orders']) refreshes this too — including on the kitchen_push_log tick
    // that flips the batch.
    queryKey: [...QUERY_KEYS.MY_ORDERS, 'states'],
    queryFn: async (): Promise<Map<number, OrderState>> => {
      // RPC post-dates the generated types — cast (MF-08 pattern).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('my_order_states');
      if (error) throw new Error(error.message);
      return new Map<number, OrderState>(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data ?? []).map((r: any) => [Number(r.order_id), r.state as OrderState]),
      );
    },
    enabled: !!userId,
    staleTime: QUERY_STALE_TIME,
  });
}

/**
 * Orders still IN FLIGHT, with their items — the set the Home rail needs.
 *
 * A DEDICATED QUERY, NOT A SLICE OF HISTORY. The rail used to count active
 * orders out of `useMyOrders`'s first page, on the reasoning that anything
 * still in flight is by definition recent. That held while a checkout was
 * one row. It is not true now: one cart writes a row per cycle AND per type,
 * so a 20-row page covers roughly half as many orders as it used to, and a
 * customer with any history had live orders sitting on page 2 that nothing
 * ever fetched. The badge quietly under-counted — 9 where the answer was 10.
 *
 * THE ID LIST COMES FROM THE SERVER, not from a status filter here. This used
 * to ask for "anything not Delivered / Cancelled / Failed", which has no time
 * bound at all: an order nobody ever marked Delivered stayed on the rail for
 * ever, still worded "Dispatched by : 7:30 AM", while the same order sat on
 * the admin Undelivered tab as lost. Asking `my_order_states()` for the 'live'
 * set is what puts this surface on the same batch rule as the Kitchen,
 * Packing, driver, hub and vendor boards. It also drops 'Pending' — an
 * unfinished card checkout is not something being delivered, and
 * PendingPaymentBanner already covers it on Home.
 *
 * Subscription PURCHASES never appear: they have no cycle, so
 * `my_order_states()` does not return them at all.
 */
export function useActiveOrders() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const states = useMyOrderStates();

  const liveIds = useMemo(
    () =>
      [...(states.data ?? new Map<number, OrderState>())]
        .filter(([, state]) => state === 'live')
        .map(([id]) => id),
    [states.data],
  );

  const rows = useSupabaseQuery<OrderWithItems>(
    // The id list is part of the key: when the batch flips and an order stops
    // being live, this is a different question and deserves a different entry.
    [...QUERY_KEYS.MY_ORDERS, 'active', liveIds.join(',')],
    () =>
      supabase
        .from('orders')
        // The address LABEL comes with the rows: an arrival is per door, so
        // when a customer has deliveries to more than one of theirs in the
        // same window the rail has to say which is which — otherwise two
        // identical "7:30 AM" headings read as a duplicate.
        .select('*, order_items(*), customer_addresses(label)')
        .in('id', liveIds)
        .order('dispatch_date', { ascending: true })
        .order('id', { ascending: true }),
    // No live ids means no question to ask — skip the round trip rather than
    // sending `in ()`. The caller reads `data ?? []`, so the rail is empty and
    // hides itself, which is the intended outcome.
    { enabled: !!userId && states.data !== undefined && liveIds.length > 0 },
  );

  /**
   * ONE refetch for the caller, and it has to be. The state map decides which
   * ids are asked for, so refreshing the rows alone would re-fetch the same
   * stale id list and the rail would go on showing an order the server has
   * already retired.
   *
   * Through the query CLIENT rather than by calling the two `refetch`
   * functions, because this value is handed to `useFocusEffect` in HomeRails
   * and therefore has to be stable. Composing the two refetch callbacks gave
   * it a new identity on every render, which re-runs the focus effect on
   * every render — a refetch loop, not a refresh. `queryClient` never changes.
   */
  const queryClient = useQueryClient();
  const refetch = useCallback(async () => {
    // States first: it decides the id list the row query is keyed on.
    await queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.MY_ORDERS, 'states'] });
    await queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.MY_ORDERS, 'active'] });
  }, [queryClient]);

  return { data: rows.data, isLoading: states.isLoading || rows.isLoading, refetch };
}

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
      // Poll every 15s ONLY while a pending order actually exists; idle
      // otherwise. Checkout invalidates MY_ORDERS after placing an order,
      // which refetches this query and restarts the poll when one appears.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      refetchInterval: (query: any) =>
        ((query?.state?.data?.length ?? 0) > 0 ? 15_000 : false),
    }
  );
}
