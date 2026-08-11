/**
 * 1stOne F1 — useSubscriptionPlans
 *
 * Admin CRUD for subscription_plans.
 * Table: subscription_plans {
 *   id, name, cycle_id, type ('food'|'essentials'), duration_days,
 *   price, is_active, plan_items (JSON string), branch_id
 * }
 *
 * plan_items JSON: [{ item_id, item_name, quantity, unit?, base_quantity? }]
 *
 * For a FOOD plan `item_id` is a building-block item — `menu_items` with
 * `is_customer_visible = false` — never a menu. A plan is a composition in its
 * own right, the same as a menu is, so it is built from the same parts rather
 * than out of another composition. `unit` / `base_quantity` snapshot the
 * block's portion at build time. See `src/utils/planItems.ts`.
 *
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter, requireWriteBranch } from './useBranchFilter';

export type PlanType = 'food' | 'essentials';

/** Re-exported from the single definition so callers have one shape to import. */
export type { SubscriptionPlanItem as PlanItem } from '../types';

export interface SubscriptionPlan {
  id: number;
  plan_name: string;
  cycle_id: number;
  plan_type: PlanType;
  duration_days: number;
  price: number;
  is_active: boolean;
  plan_items: string; // JSON string of PlanItem[]
  branch_id: number | null;
  /** Plan photo — see `catalogPhoto.ts`. Set from this screen. */
  image_path?: string | null;
  image_updated_at?: string | null;
}

export function useAllPlans(cycleId?: number, type?: PlanType) {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['admin_plans', cycleId ?? 'all', type ?? 'all', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('subscription_plans')
        .select('*')
        // The RANGE, not one customer's plan. Customs are per-person and
        // one-off: left in, this list would fill with them and the admin
        // would lose sight of what is actually on offer.
        .eq('is_custom', false)
        .order('plan_name', { ascending: true });
      if (cycleId) query = query.eq('cycle_id', cycleId);
      if (type === 'essentials') {
        query = query.eq('plan_type', 'essentials');
      } else if (type === 'food') {
        // also surface legacy rows that predate the plan_type column
        query = query.or('plan_type.eq.food,plan_type.is.null');
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
      plan_name: string;
      cycle_id: number;
      plan_type: PlanType;
      duration_days: number;
      price: number;
      savings_amount: number;
      plan_items: string;
    }) => {
      const { error } = await supabase
        .from('subscription_plans')
        .insert({
          plan_name: plan.plan_name,
          plan_type: plan.plan_type,
          cycle_id: plan.cycle_id,
          duration_days: plan.duration_days,
          price: plan.price,
          savings_amount: plan.savings_amount,
          plan_items: plan.plan_items,
          is_active: true,
          branch_id: requireWriteBranch(bf),
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
