/**
 * 1stOne F1 — useStaffLeave
 *
 * Staff-facing hooks for viewing and submitting leave requests.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { StaffLeave } from '../types';

export function useMyLeaves() {
  const { session } = useAuth();
  return useQuery({
    queryKey: [...QUERY_KEYS.STAFF_LEAVES, session?.user.id],
    queryFn: async () => {
      if (!session) return [];
      const { data, error } = await supabase
        .from('staff_leaves')
        .select('*')
        .eq('staff_id', session.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as StaffLeave[];
    },
    enabled: !!session,
    staleTime: QUERY_STALE_TIME,
  });
}

export function useApplyLeave() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      start_date: string;
      end_date: string;
      reason: string;
    }) => {
      if (!session) throw new Error('Not authenticated');
      const { error } = await supabase.from('staff_leaves').insert({
        staff_id: session.user.id,
        start_date: payload.start_date,
        end_date: payload.end_date,
        reason: payload.reason || null,
        status: 'Pending',
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_LEAVES }),
  });
}
