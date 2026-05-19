/**
 * 1stOne F1 — useExpenseManager
 *
 * Admin hooks for the Expense Manager — staff expense claims (approve → paid)
 * and admin-logged business expenses. All through the shared hook layer.
 * Filtered by branch when branch_management_active is on.
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { useAuth } from './useAuth';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter, requireWriteBranch } from './useBranchFilter';
import type { ExpenseClaim, BusinessExpense } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClaimWithProfile = ExpenseClaim & { profiles: any };

// ── Staff expense claims ──────────────────────────────────────

/** All claims joined with staff profile, ordered newest first */
export function useAllExpenseClaimsAdmin() {
  const bf = useBranchFilter();
  return useSupabaseQuery<ClaimWithProfile>(
    ['admin_expense_claims', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let query = supabase
        .from('expense_claims')
        .select('*, profiles!expense_claims_staff_id_fkey(full_name, phone_number, employee_id)')
        .order('created_at', { ascending: false });
      if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId);
      return query;
    },
    { staleTime: QUERY_STALE_TIME },
  );
}

/** Approve or reject a pending claim */
export function useReviewExpenseClaim() {
  const { session } = useAuth();
  return useSupabaseMutation<{ claimId: number; status: 'Approved' | 'Rejected' }>(
    ({ claimId, status }) =>
      supabase
        .from('expense_claims')
        .update({ status, approved_by: session?.user.id ?? null })
        .eq('id', claimId),
    [['admin_expense_claims']],
  );
}

/** Mark an approved claim as paid */
export function useMarkClaimPaid() {
  return useSupabaseMutation<number>(
    (claimId) =>
      supabase
        .from('expense_claims')
        .update({ status: 'Paid', paid_at: new Date().toISOString() })
        .eq('id', claimId),
    [['admin_expense_claims']],
  );
}

// ── Business expenses (admin-logged) ─────────────────────────

export const EXPENSE_CATEGORIES = [
  'Grocery',
  'Vegetables',
  'Stationery',
  'Fuel',
  'Maintenance',
  'Utilities',
  'Rent',
  'Marketing',
  'Others',
];

export function useBusinessExpenses() {
  const { session } = useAuth();
  const bf = useBranchFilter();

  const query = useSupabaseQuery<BusinessExpense>(
    ['business_expenses', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let q = supabase
        .from('business_expenses')
        .select('*')
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (bf.isActive && bf.branchId != null) q = q.eq('branch_id', bf.branchId);
      return q;
    },
    { staleTime: QUERY_STALE_TIME },
  );

  const add = useSupabaseMutation<{
    category: string;
    description: string;
    amount: number;
    expense_date: string;
    vendor: string;
    is_paid: boolean;
  }>(
    (payload) =>
      supabase.from('business_expenses').insert({
        ...payload,
        vendor: payload.vendor || null,
        recorded_by: session?.user.id ?? null,
        paid_at: payload.is_paid ? new Date().toISOString() : null,
        branch_id: requireWriteBranch(bf),
      }),
    [['business_expenses']],
  );

  const markPaid = useSupabaseMutation<number>(
    (expenseId) =>
      supabase
        .from('business_expenses')
        .update({ is_paid: true, paid_at: new Date().toISOString() })
        .eq('id', expenseId),
    [['business_expenses']],
  );

  return { ...query, add, markPaid };
}
