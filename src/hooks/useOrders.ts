/**
 * 1stOne F1 — useOrders
 *
 * Fetches customer order history and order detail.
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery } from '../api/useSupabaseQuery';
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

