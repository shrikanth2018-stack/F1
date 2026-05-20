/**
 * 1stOne F1 — useAttendanceCorrections
 *
 * Staff submits a single request listing one or more past days they
 * forgot to clock in / out for, with intended clock-in / clock-out
 * times + reason. Admin reviews from Resource Manager and Approves or
 * Rejects. Approval inserts the staff_attendance rows atomically;
 * conflicts (the day already has a clock-in row) block the approval
 * server-side so admin must resolve manually before re-approving.
 *
 * Pattern mirrors useStaffLeave (the leave-request flow) so admin UX
 * stays consistent across the two reviewable surfaces.
 */

import { supabase } from '../api/supabaseClient';
import {
  useSupabaseQuery,
  useSupabaseMutation,
} from '../api/useSupabaseQuery';
import { useAuth } from './useAuth';
import { useBranchFilter } from './useBranchFilter';

export type AttendanceCorrectionStatus = 'pending' | 'approved' | 'rejected';

export interface AttendanceCorrectionDay {
  id?: number;
  request_id?: number;
  the_date: string;          // YYYY-MM-DD
}

export interface AttendanceCorrectionRequest {
  id: number;
  staff_id: string;
  reason: string;
  status: AttendanceCorrectionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
  // Join shape — populated when the caller asks for it.
  days?: AttendanceCorrectionDay[];
  profiles?: { full_name: string | null; phone_number: string | null } | null;
}

// ── Staff: my requests ────────────────────────────────────────

export function useMyAttendanceCorrections() {
  const { session } = useAuth();

  return useSupabaseQuery<AttendanceCorrectionRequest>(
    ['attendance_corrections', 'mine', session?.user.id],
    () =>
      supabase
        .from('attendance_correction_requests')
        .select(
          '*, days:attendance_correction_days(id, the_date)',
        )
        .eq('staff_id', session?.user.id ?? '')
        .order('created_at', { ascending: false }),
    { enabled: !!session?.user.id },
  );
}

// ── Staff: submit ─────────────────────────────────────────────
//
// Two-call mutation: insert the parent request, then bulk-insert the
// days using the new id. Wrapped in a single mutateAsync so the staff
// UI sees one promise. The request RLS check (status='pending') keeps
// staff from sneaking through any other status on insert.

export interface SubmitCorrectionPayload {
  reason: string;
  days: { the_date: string }[];
}

export function useSubmitAttendanceCorrection() {
  const { session } = useAuth();

  return useSupabaseMutation<SubmitCorrectionPayload, { request_id: number }>(
    async (payload) => {
      const uid = session?.user.id;
      if (!uid) {
        return { data: null, error: { message: 'Not authenticated' } };
      }

      const { data: reqRow, error: reqErr } = await supabase
        .from('attendance_correction_requests')
        .insert({ staff_id: uid, reason: payload.reason, status: 'pending' })
        .select('id')
        .single();
      if (reqErr || !reqRow) {
        return { data: null, error: reqErr ?? { message: 'Insert failed' } };
      }

      const { error: daysErr } = await supabase
        .from('attendance_correction_days')
        .insert(
          payload.days.map((d) => ({
            request_id: reqRow.id,
            the_date: d.the_date,
          })),
        );
      if (daysErr) {
        // Best-effort rollback of the header row; if this fails the
        // header lingers in 'pending' with zero days and admin can
        // safely reject it.
        await supabase
          .from('attendance_correction_requests')
          .delete()
          .eq('id', reqRow.id);
        return { data: null, error: daysErr };
      }

      return { data: { request_id: reqRow.id }, error: null };
    },
    [['attendance_corrections']],
  );
}

// ── Admin: pending requests in branch ────────────────────────

export function useAdminAttendanceCorrections(
  status: AttendanceCorrectionStatus | 'all' = 'pending',
) {
  const bf = useBranchFilter();
  const branchKey = bf.isActive ? bf.branchId ?? 'all' : 'off';

  return useSupabaseQuery<AttendanceCorrectionRequest>(
    ['attendance_corrections', 'admin', status, branchKey],
    () => {
      let q = supabase
        .from('attendance_correction_requests')
        .select(
          '*, ' +
            'days:attendance_correction_days(id, the_date), ' +
            'profiles!attendance_correction_requests_staff_id_fkey(full_name, phone_number)',
        )
        .order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      if (bf.isActive && bf.branchId != null) q = q.eq('branch_id', bf.branchId);
      return q;
    },
  );
}

// ── Admin: approve / reject ──────────────────────────────────
//
// Both call the atomic SECURITY DEFINER RPC. Approval refuses if any
// requested day already has a staff_attendance row — admin must
// resolve the conflict (delete the existing row or reject the
// request) before re-approving.

export function useApproveAttendanceCorrection() {
  return useSupabaseMutation<number, { request_id: number; days_applied: number }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requestId) => (supabase as any).rpc('approve_attendance_correction', { p_request_id: requestId }),
    [['attendance_corrections'], ['staff_attendance']],
  );
}

export function useRejectAttendanceCorrection() {
  return useSupabaseMutation<{ requestId: number; note?: string }>(
    ({ requestId, note }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc('reject_attendance_correction', {
        p_request_id: requestId,
        p_note: note ?? null,
      }),
    [['attendance_corrections']],
  );
}
