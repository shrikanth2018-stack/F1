/**
 * 1stOne F1 — useCustomerFeedback
 *
 * Admin read of app_feedback joined with profiles.
 * Feedback = general (order_id IS NULL) — submitted from Profile menu.
 * Reviews  = order-linked (order_id IS NOT NULL) — submitted from Order Detail.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';

export interface FeedbackEntry {
  id: number;
  user_id: string;
  order_id: number | null;
  rating: number;
  comments: string | null;
  created_at: string;
  profiles: {
    full_name: string | null;
    phone_number: string;
  } | null;
}

export function useAllFeedback() {
  const bf = useBranchFilter();
  return useQuery({
    queryKey: ['admin_feedback', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      // app_feedback has no branch_id column. For branch isolation, pull the
      // linked order's branch_id and filter after fetch. Feedback with no
      // order (general "Rate the App") is branch-agnostic — always included.
      const { data, error } = await supabase
        .from('app_feedback')
        .select('*, profiles!app_feedback_user_id_fkey(full_name, phone_number), orders!app_feedback_order_id_fkey(branch_id)')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as (FeedbackEntry & { orders: { branch_id: number | null } | null })[];

      if (!bf.isActive || bf.branchId == null) {
        // Super admin / flag off — return everything
        return rows as FeedbackEntry[];
      }
      // Branch admin — keep general feedback + reviews tied to this branch
      return rows.filter((r) => r.orders == null || r.orders.branch_id === bf.branchId) as FeedbackEntry[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

export interface OrderItemRating {
  id: number;
  order_id: number;
  order_item_id: number;
  rating: number;
  created_at: string;
  item_name: string | null;
}

/**
 * Batch-fetches per-item ratings for the given order IDs, joined with the
 * item name from order_items. Returns a map: order_id → list of rated items.
 * Safe to call with an empty array — returns an empty map.
 */
export function useOrderItemRatings(orderIds: number[]) {
  return useQuery({
    queryKey: ['order_item_ratings', ...orderIds.sort((a, b) => a - b)],
    queryFn: async () => {
      if (orderIds.length === 0) return new Map<number, OrderItemRating[]>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('order_item_ratings')
        .select('id, order_id, order_item_id, rating, created_at, order_items(item_name)')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);

      const byOrder = new Map<number, OrderItemRating[]>();
      for (const r of (data ?? []) as any[]) {
        const row: OrderItemRating = {
          id: r.id,
          order_id: r.order_id,
          order_item_id: r.order_item_id,
          rating: r.rating,
          created_at: r.created_at,
          item_name: r.order_items?.item_name ?? null,
        };
        const list = byOrder.get(row.order_id) ?? [];
        list.push(row);
        byOrder.set(row.order_id, list);
      }
      return byOrder;
    },
    enabled: orderIds.length > 0,
    staleTime: QUERY_STALE_TIME,
  });
}
