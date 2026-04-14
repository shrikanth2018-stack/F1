/**
 * 1stOne F1 — useResourceManager
 *
 * Admin hooks for the Resource Manager (staff onboarding, attendance,
 * leaves, salary). Complements useStaffManagement which handles
 * expense/leave approval flows.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useAuth } from './useAuth';
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
  return useQuery({
    queryKey: ['resource_roster', today],
    queryFn: async () => {
      const [profilesRes, attendanceRes, leavesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .eq('role', 'staff')
          .order('created_at', { ascending: true }),
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

/** Generate next employee ID like 1ST-2026-007 */
export async function generateEmployeeId(): Promise<string> {
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'staff');
  const seq = String((count ?? 0) + 1).padStart(3, '0');
  return `1ST-${year}-${seq}`;
}

export function useOnboardEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OnboardPayload & { employee_id: string }) => {
      // Insert profile row — staff member logs in via phone OTP
      const staffId = crypto.randomUUID();
      const { error: profileErr } = await supabase.from('profiles').insert({
        id: staffId,
        role: 'staff',
        phone_number: payload.phone_number,
        full_name: payload.full_name,
        employee_id: payload.employee_id,
        designation: payload.designation,
        joining_date: payload.joining_date,
        shift_timing: payload.shift_timing,
        assigned_hub_id: payload.assigned_hub_id,
        monthly_salary: payload.monthly_salary,
        benefits: payload.benefits || null,
        wallet_balance: 0,
        loyalty_points: 0,
      });
      if (profileErr) throw new Error(profileErr.message);

      // Auto-create first salary record for current month
      if (payload.monthly_salary > 0) {
        const now = new Date();
        const { error: salErr } = await supabase.from('staff_salary').insert({
          staff_id: staffId,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          base_salary: payload.monthly_salary,
          deductions: 0,
          bonus: payload.joining_bonus,
          net_salary: payload.monthly_salary + payload.joining_bonus,
          is_paid: false,
        });
        if (salErr) throw new Error(salErr.message);
      }
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

  const query = useQuery({
    queryKey: ['resource_pending_leaves'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_leaves')
        .select('*, profiles!staff_leaves_staff_id_fkey(full_name, phone_number, employee_id)')
        .eq('status', 'Pending')
        .order('created_at', { ascending: true });
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

// ── Hubs list (for hub assignment picker) ────────────────────

export function useDeliveryHubs() {
  return useQuery({
    queryKey: ['delivery_hubs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_hubs')
        .select('id, hub_name')
        .eq('is_active', true)
        .order('hub_name');
      if (error) throw error;
      return (data ?? []) as { id: number; hub_name: string }[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}
