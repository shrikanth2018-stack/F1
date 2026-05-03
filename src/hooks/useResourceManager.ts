/**
 * 1stOne F1 — useResourceManager
 *
 * Admin hooks for the Resource Manager (staff onboarding, attendance,
 * leaves, salary). Complements useStaffManagement which handles
 * expense/leave approval flows.
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useAuth } from './useAuth';
import { useBranchFilter } from './useBranchFilter';
import type { Profile, StaffAttendance, StaffLeave, StaffSalary } from '../types';

export const DESIGNATIONS = [
  'Kitchen Staff',
  'Packing Staff',
  'Delivery Staff',
  'Hub Staff',
  'Manager',
  'Admin',
];

export const SHIFTS = [
  'Morning  (6 AM – 2 PM)',
  'Afternoon  (2 PM – 10 PM)',
  'All Day  (8 AM – 6 PM)',
  'Custom',
];

export const BENEFIT_OPTIONS = [
  'PF',
  'ESI',
  'Medical',
  'Travel Allowance',
  'Food Allowance',
  'House Allowance',
];

// ── Roster ───────────────────────────────────────────────────

/** All staff with today attendance + leave status joined */
export function useStaffRoster() {
  const today = new Date().toISOString().split('T')[0];
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['resource_roster', today, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let profilesQuery = supabase
        .from('profiles')
        .select('*')
        .eq('role', 'staff')
        .order('created_at', { ascending: true });

      if (bf.isActive && bf.branchId != null) {
        profilesQuery = profilesQuery.eq('branch_id', bf.branchId);
      }

      const [profilesRes, attendanceRes, leavesRes] = await Promise.all([
        profilesQuery,
        supabase
          .from('staff_attendance')
          .select('staff_id, clock_in_time, clock_out_time')
          .eq('date', today),
        supabase
          .from('staff_leaves')
          .select('staff_id')
          .eq('status', 'Approved')
          .lte('start_date', today)
          .gte('end_date', today),
      ]);

      if (profilesRes.error) throw profilesRes.error;

      const attendanceMap = new Map(
        (attendanceRes.data ?? []).map((a) => [a.staff_id, a])
      );
      const leaveSet = new Set(
        (leavesRes.data ?? []).map((l) => l.staff_id)
      );

      return (profilesRes.data ?? []).map((p) => ({
        ...(p as Profile),
        todayStatus: leaveSet.has(p.id)
          ? ('leave' as const)
          : attendanceMap.has(p.id)
          ? ('present' as const)
          : ('absent' as const),
        clockIn: attendanceMap.get(p.id)?.clock_in_time ?? null,
        clockOut: attendanceMap.get(p.id)?.clock_out_time ?? null,
      }));
    },
    staleTime: QUERY_STALE_TIME,
  });
}

export type RosterEntry = NonNullable<ReturnType<typeof useStaffRoster>['data']>[number];

// ── Onboarding ───────────────────────────────────────────────

export interface OnboardPayload {
  full_name: string;
  phone_number: string;
  designation: string;
  joining_date: string;
  shift_timing: string;
  assigned_hub_id: number | null;
  monthly_salary: number;
  benefits: string;       // comma-separated
  joining_bonus: number;  // credited as first-month bonus; 0 if none
}

/**
 * Onboard a new staff member via the elevate-employee Edge Function.
 * The function finds-or-creates the auth user by phone, sets the JWT
 * user_role claim to 'staff', and atomically writes the profile +
 * first-month salary row. Employee ID is allocated server-side from
 * a Postgres SEQUENCE — race-free across concurrent admins.
 */
export function useOnboardEmployee() {
  const queryClient = useQueryClient();
  const bf = useBranchFilter();
  return useMutation({
    mutationFn: async (payload: OnboardPayload): Promise<{ employee_id: string; user_id: string }> => {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('elevate-employee', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: { ...payload, branch_id: bf.branchId ?? 1 },
      });

      if (error || data?.error) {
        let message = data?.error ?? 'Failed to onboard employee';
        try {
          const ctx = (error as any)?.context;
          if (ctx) {
            const txt = await (ctx.clone ? ctx.clone() : ctx).text();
            const parsed = JSON.parse(txt);
            if (parsed?.error) message = parsed.error;
          }
        } catch {}
        throw new Error(message);
      }
      return data as { employee_id: string; user_id: string };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resource_roster'] }),
  });
}

// ── Employee profile update ──────────────────────────────────

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      staffId,
      updates,
    }: {
      staffId: string;
      updates: Partial<Pick<Profile, 'full_name' | 'designation' | 'joining_date' | 'shift_timing' | 'assigned_hub_id' | 'monthly_salary' | 'benefits'>>;
    }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', staffId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['resource_roster'] });
      queryClient.invalidateQueries({ queryKey: ['employee_detail', vars.staffId] });
    },
  });
}

// ── Attendance ───────────────────────────────────────────────

/** Fetch all attendance records for one employee in a given month */
export function useEmployeeMonthAttendance(
  staffId: string,
  year: number,
  month: number   // 1-based
) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to   = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

  return useQuery({
    queryKey: ['emp_attendance', staffId, year, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_attendance')
        .select('*')
        .eq('staff_id', staffId)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as StaffAttendance[];
    },
    enabled: !!staffId,
    staleTime: QUERY_STALE_TIME,
  });
}

// ── Leaves ───────────────────────────────────────────────────

export function useEmployeeLeaves(staffId: string) {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['emp_leaves', staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_leaves')
        .select('*')
        .eq('staff_id', staffId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as StaffLeave[];
    },
    enabled: !!staffId,
    staleTime: QUERY_STALE_TIME,
  });

  const review = useMutation({
    mutationFn: async ({
      leaveId,
      status,
    }: {
      leaveId: number;
      status: 'Approved' | 'Rejected';
    }) => {
      const { error } = await supabase
        .from('staff_leaves')
        .update({ status, approved_by: session?.user.id ?? null })
        .eq('id', leaveId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emp_leaves', staffId] });
      queryClient.invalidateQueries({ queryKey: ['resource_roster'] });
    },
  });

  return { ...query, review };
}

// ── Salary ───────────────────────────────────────────────────

export function useEmployeeSalary(staffId: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['emp_salary', staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_salary')
        .select('*')
        .eq('staff_id', staffId)
        .order('year', { ascending: false })
        .order('month', { ascending: false });
      if (error) throw error;
      return (data ?? []) as StaffSalary[];
    },
    enabled: !!staffId,
    staleTime: QUERY_STALE_TIME,
  });

  const markPaid = useMutation({
    mutationFn: async (salaryId: number) => {
      const { error } = await supabase
        .from('staff_salary')
        .update({ is_paid: true, paid_at: new Date().toISOString() })
        .eq('id', salaryId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emp_salary', staffId] }),
  });

  const addRecord = useMutation({
    mutationFn: async (record: {
      month: number;
      year: number;
      base_salary: number;
      deductions: number;
      bonus: number;
    }) => {
      const net = record.base_salary - record.deductions + record.bonus;
      const { error } = await supabase.from('staff_salary').insert({
        staff_id: staffId,
        ...record,
        net_salary: net,
        is_paid: false,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emp_salary', staffId] }),
  });

  return { ...query, markPaid, addRecord };
}

// ── Pending leave approvals (for ResourceManager home) ───────

export function usePendingLeaves() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const bf = useBranchFilter();

  const query = useQuery({
    queryKey: ['resource_pending_leaves', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let q = supabase
        .from('staff_leaves')
        .select('*, profiles!staff_leaves_staff_id_fkey(full_name, phone_number, employee_id)')
        .eq('status', 'Pending')
        .order('created_at', { ascending: true });

      if (bf.isActive && bf.branchId != null) {
        // filter by branch via joined profile
        q = q.eq('profiles.branch_id', bf.branchId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
    staleTime: QUERY_STALE_TIME,
  });

  const review = useMutation({
    mutationFn: async ({ leaveId, status }: { leaveId: number; status: 'Approved' | 'Rejected' }) => {
      const { error } = await supabase
        .from('staff_leaves')
        .update({ status, approved_by: session?.user.id ?? null })
        .eq('id', leaveId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource_pending_leaves'] });
      queryClient.invalidateQueries({ queryKey: ['resource_roster'] });
    },
  });

  return { ...query, review };
}

// useDeliveryHubs moved to src/hooks/useDeliveryHubs.ts (full CRUD version)
