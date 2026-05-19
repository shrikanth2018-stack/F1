/**
 * 1stOne F1 — useStaffManagement
 *
 * Admin hooks for staff profiles, store config and feature flags.
 * (Expense/leave/attendance review live in useExpenseManager,
 * useResourceManager and useAttendance.)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { Profile } from '../types';

/** Fetch all staff profiles (includes admins per FT-03 — ADMIN HEAD = role 'admin'). */
export function useAllStaff() {
  return useQuery({
    queryKey: ['admin_staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('role', ['staff', 'admin'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Admin: update store config */
export function useUpdateStoreConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { error } = await supabase
        .from('store_config')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(updates as any)
        .eq('id', 1);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STORE_CONFIG });
    },
  });
}

/** Admin: update feature flags */
export function useUpdateFeatureFlag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, flag_value }: { id: number; flag_value: boolean }) => {
      const { error } = await supabase
        .from('feature_flags')
        .update({ flag_value })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FEATURE_FLAGS });
    },
  });
}
