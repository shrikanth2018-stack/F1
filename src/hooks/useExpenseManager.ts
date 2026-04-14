/**
 * 1stOne F1 — useExpenseManager
 *
 * Admin hooks for the Expense Manager:
 *   - Staff expense claims  (approve → paid flow)
 *   - Business expenses     (admin-logged operational spending)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { QUERY_STALE_TIME } from '../utils/constants';
import type { ExpenseClaim, BusinessExpense } from '../types';

// ── Staff expense claims ──────────────────────────────────────

/** All claims joined with staff profile, ordered newest first */
export function useAllExpenseClaimsAdmin() {
  return useQuery({
    queryKey: ['admin_expense_claims'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expense_claims')
        .select('*, profiles!expense_claims_staff_id_fkey(full_name, phone_number, employee_id)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as (ExpenseClaim & { profiles: any })[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Approve or reject a pending claim */
export function useReviewExpenseClaim() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ claimId, status }: { claimId: number; status: 'Approved' | 'Rejected' }) => {
      const { error } = await supabase
        .from('expense_claims')
        .update({ status, approved_by: session?.user.id ?? null })
        .eq('id', claimId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_expense_claims'] }),
  });
}

/** Mark an approved claim as paid */
export function useMarkClaimPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (claimId: number) => {
      const { error } = await supabase
        .from('expense_claims')
        .update({ status: 'Paid', paid_at: new Date().toISOString() })
        .eq('id', claimId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_expense_claims'] }),
  });
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
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const query = useQuery({
    queryKey: ['business_expenses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_expenses')
        .select('*')
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as BusinessExpense[];
    },
    staleTime: QUERY_STALE_TIME,
  });

  const add = useMutation({
    mutationFn: async (payload: {
      category: string;
      description: string;
      amount: number;
      expense_date: string;
      vendor: string;
      is_paid: boolean;
    }) => {
      const { error } = await supabase.from('business_expenses').insert({
        ...payload,
        vendor: payload.vendor || null,
        recorded_by: session?.user.id ?? null,
        paid_at: payload.is_paid ? new Date().toISOString() : null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['business_expenses'] }),
  });

  const markPaid = useMutation({
    mutationFn: async (expenseId: number) => {
      const { error } = await supabase
        .from('business_expenses')
        .update({ is_paid: true, paid_at: new Date().toISOString() })
        .eq('id', expenseId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['business_expenses'] }),
  });

  return { ...query, add, markPaid };
}
