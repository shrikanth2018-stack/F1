/**
 * 1stOne F1 — useStaffManagement
 *
 * Admin hooks for managing staff:
 * - Fetch all staff profiles
 * - Approve/reject expense claims
 * - Approve/reject leave requests
 * - View all attendance records
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { useBranchFilter } from './useBranchFilter';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { Profile, ExpenseClaim, StaffLeave, StaffAttendance } from '../types';

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

/** Fetch all pending expense claims */
export function useAllExpenseClaims(statusFilter?: string) {
  return useQuery({
    queryKey: ['admin_expenses', statusFilter ?? 'all'],
    queryFn: async () => {
      let query = supabase
        .from('expense_claims')
        .select('*, profiles!expense_claims_staff_id_fkey(full_name, phone_number)')
        .order('created_at', { ascending: false });

      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as (ExpenseClaim & { profiles: any })[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Approve or reject an expense claim */
export function useReviewExpense() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      claimId,
      status,
    }: {
      claimId: number;
      status: 'Approved' | 'Rejected';
    }) => {
      const { error } = await supabase
        .from('expense_claims')
        .update({
          status,
          approved_by: session?.user.id ?? null,
        })
        .eq('id', claimId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_expenses'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.EXPENSE_CLAIMS });
      queryClient.invalidateQueries({ queryKey: ['admin_stats'] });
    },
  });
}

/** Fetch all leave requests — branch-filtered via the staff member's profile */
export function useAllLeaveRequests(statusFilter?: string) {
  const bf = useBranchFilter();
  return useQuery({
    queryKey: ['admin_leaves', statusFilter ?? 'all', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      // staff_leaves has no branch_id column — join profiles to filter by branch.
      let query = supabase
        .from('staff_leaves')
        .select('*, profiles!staff_leaves_staff_id_fkey(full_name, phone_number, branch_id)')
        .order('created_at', { ascending: false });

      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as (StaffLeave & { profiles: { branch_id: number | null } & Record<string, unknown> })[];

      if (!bf.isActive || bf.branchId == null) {
        return rows as unknown as (StaffLeave & { profiles: any })[];
      }
      return rows.filter((r) => r.profiles?.branch_id === bf.branchId) as unknown as (StaffLeave & { profiles: any })[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Approve or reject a leave request */
export function useReviewLeave() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      leaveId,
      status,
    }: {
      leaveId: number;
      status: 'Approved' | 'Rejected';
    }) => {
      const { error } = await supabase
        .from('staff_leaves')
        .update({
          status,
          approved_by: session?.user.id ?? null,
        })
        .eq('id', leaveId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_leaves'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_LEAVES });
    },
  });
}

/** Fetch today's attendance for all staff */
export function useAllStaffAttendance(date?: string) {
  const targetDate = date ?? new Date().toISOString().split('T')[0];

  return useQuery({
    queryKey: ['admin_attendance', targetDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_attendance')
        .select('*, profiles!staff_attendance_staff_id_fkey(full_name, phone_number)')
        .eq('date', targetDate)
        .order('clock_in_time', { ascending: true });
      if (error) throw error;
      return (data ?? []) as (StaffAttendance & { profiles: any })[];
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
