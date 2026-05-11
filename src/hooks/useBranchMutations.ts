/**
 * 1stOne F1 — useBranchMutations
 *
 * Super-admin CRUD over the `branches` table for the Branches Manage screen
 * (FT-04). Server RLS (`branches_admin_write`) is the authority — these
 * hooks just shape the calls.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS } from '../utils/constants';

function invalidateBranchCaches(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: [...QUERY_KEYS.BRANCHES, 'active'] });
  qc.invalidateQueries({ queryKey: [...QUERY_KEYS.BRANCHES, 'all'] });
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { branch_name: string; address?: string | null; phone?: string | null }) => {
      const { data, error } = await supabase
        .from('branches')
        .insert({
          branch_name: input.branch_name.trim(),
          address: input.address?.trim() || null,
          phone: input.phone?.trim() || null,
          is_active: true,
        })
        .select('id, branch_name, address, phone, is_active, created_at')
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => invalidateBranchCaches(qc),
  });
}

export function useUpdateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: number;
      branch_name?: string;
      address?: string | null;
      phone?: string | null;
    }) => {
      const patch: { branch_name?: string; address?: string | null; phone?: string | null } = {};
      if (input.branch_name !== undefined) patch.branch_name = input.branch_name.trim();
      if (input.address !== undefined) patch.address = input.address?.trim() || null;
      if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
      const { error } = await supabase
        .from('branches')
        .update(patch)
        .eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateBranchCaches(qc),
  });
}

export function useToggleBranchActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; is_active: boolean }) => {
      const { error } = await supabase
        .from('branches')
        .update({ is_active: input.is_active })
        .eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateBranchCaches(qc),
  });
}

/**
 * Count active subscriptions + open orders for a branch — used as a
 * pre-flight check before deactivating, so the super-admin sees what
 * will keep operating after the flip.
 */
export async function fetchBranchActivityCounts(branchId: number) {
  const [subsRes, ordersRes] = await Promise.all([
    supabase
      .from('user_subscriptions')
      .select('id, subscription_plans!inner(branch_id)', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('subscription_plans.branch_id', branchId),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', branchId)
      .neq('status', 'Delivered')
      .neq('status', 'Cancelled'),
  ]);
  return {
    activeSubs: subsRes.count ?? 0,
    openOrders: ordersRes.count ?? 0,
  };
}
