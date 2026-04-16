/**
 * 1stOne F1 — useSubscriptionPlans
 *
 * Admin CRUD for subscription_plans.
 * Table: subscription_plans {
 *   id, name, cycle_id, type ('food'|'essentials'), duration_days,
 *   price, is_active, plan_items (JSON string), branch_id
 * }
 *
 * plan_items JSON: [{ item_id: number, item_name: string, quantity: number }]
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';

export type PlanType = 'food' | 'essentials';

export interface PlanItem {
  item_id: number;
  item_name: string;
  quantity: number;
}

export interface SubscriptionPlan {
  id: number;
  name: string;
  cycle_id: number;
  type: PlanType;
  duration_days: number;
  price: number;
  is_active: boolean;
  plan_items: string; // JSON string of PlanItem[]
  branch_id: number | null;
}

export function useAllPlans(cycleId?: number, type?: PlanType) {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['admin_plans', cycleId ?? 'all', type ?? 'all', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('subscription_plans')
        .select('*')
        .order('name', { ascending: true });
      if (cycleId) query = query.eq('cycle_id', cycleId);
      if (type === 'essentials') {
        query = query.eq('type', 'essentials');
      } else if (type === 'food') {
        // also surface legacy rows that predate the type column
        query = query.or('type.eq.food,type.is.null');
      }
      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as SubscriptionPlan[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

export function useAddPlan() {
  const queryClient = useQueryClient();
  const bf = useBranchFilter();
  return useMutation({
    mutationFn: async (plan: {
      name: string;
      cycle_id: number;
      type: PlanType;
      duration_days: number;
      price: number;
      plan_items: string;
    }) => {
      const { error } = await supabase
        .from('subscription_plans')
        .insert({
          ...plan,
          is_active: true,
          branch_id: bf.isActive ? bf.branchId : null,
        });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_plans'] }),
  });
}

export function useUpdatePlanPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, price }: { id: number; price: number }) => {
      const { error } = await supabase
        .from('subscription_plans')
        .update({ price })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_plans'] }),
  });
}

export function useTogglePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const { error } = await supabase
        .from('subscription_plans')
        .update({ is_active })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_plans'] }),
  });
}
