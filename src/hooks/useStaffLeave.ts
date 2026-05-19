/**
 * 1stOne F1 — useStaffLeave
 *
 * Staff-facing hooks for viewing and submitting leave requests.
 * Both go through the shared Supabase hook layer.
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { useAuth } from './useAuth';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { StaffLeave } from '../types';

export function useMyLeaves() {
  const { session } = useAuth();
  return useSupabaseQuery<StaffLeave>(
    [...QUERY_KEYS.STAFF_LEAVES, session?.user.id],
    () =>
      supabase
        .from('staff_leaves')
        .select('*')
        .eq('staff_id', session?.user.id ?? '')
        .order('created_at', { ascending: false }),
    { enabled: !!session, staleTime: QUERY_STALE_TIME },
  );
}

export function useApplyLeave() {
  const { session } = useAuth();
  return useSupabaseMutation<{ start_date: string; end_date: string; reason: string }>(
    (payload) => {
      if (!session) throw new Error('Not authenticated');
      return supabase.from('staff_leaves').insert({
        staff_id: session.user.id,
        start_date: payload.start_date,
        end_date: payload.end_date,
        reason: payload.reason || null,
        status: 'Pending',
      });
    },
    [QUERY_KEYS.STAFF_LEAVES],
  );
}
