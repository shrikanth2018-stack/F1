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
  return useQuery({
    queryKey: ['admin_feedback'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_feedback')
        .select('*, profiles!app_feedback_user_id_fkey(full_name, phone_number)')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as FeedbackEntry[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}
