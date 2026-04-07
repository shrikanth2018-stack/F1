/**
 * 1stOne F1 — useOrders
 *
 * Fetches customer order history + provides place-order mutation.
 * Order placement calls Supabase Edge Function that:
 * 1. Recalculates prices server-side
 * 2. Creates Razorpay order (if payment_method != 'wallet')
 * 3. Inserts order + order_items
 * 4. Returns order with razorpay_order_id for client payment
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import { useAuth } from './useAuth';
import type { Order } from '../types';

export function useMyOrders() {
  const { session } = useAuth();

  return useSupabaseQuery<Order>(
    [...QUERY_KEYS.MY_ORDERS],
    () =>
      supabase
        .from('orders')
        .select('*')
        .eq('user_id', session?.user.id ?? '')
        .order('created_at', { ascending: false })
        .limit(50),
    { enabled: !!session?.user.id }
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

export interface PlaceOrderPayload {
  items: Array<{
    menu_item_id: number;
    quantity: number;
  }>;
  cycle_id: number;
  delivery_address_id: number;
  payment_method: 'wallet' | 'razorpay' | 'split';
  dispatch_date: string;
  notes?: string;
}

export function usePlaceOrder() {
  return useSupabaseMutation<PlaceOrderPayload, Order>(
    async (payload) => {
      // Call Edge Function for server-side order creation
      const { data, error } = await supabase.functions.invoke('place-order', {
        body: payload,
      });

      if (error) {
        return { data: null, error, count: null, status: 500, statusText: 'Error' } as any;
      }

      return { data, error: null, count: null, status: 200, statusText: 'OK' } as any;
    },
    [QUERY_KEYS.MY_ORDERS as unknown as string[], QUERY_KEYS.ORDERS as unknown as string[]]
  );
}
