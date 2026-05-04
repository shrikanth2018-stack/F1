/**
 * 1stOne F1 — useSubscriptions
 *
 * Hooks for subscription plans, user subscriptions,
 * and cancelled/skipped days management.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import { useAuth } from './useAuth';
import type {
  SubscriptionPlan,
  SubscriptionPlanItem,
  UserSubscription,
  CancelledSubscriptionDay,
} from '../types';

// ── Available Plans ──

export function useSubscriptionPlans(cycleId?: number | null) {
  const queryKey = cycleId
    ? [...QUERY_KEYS.SUBSCRIPTION_PLANS, cycleId]
    : QUERY_KEYS.SUBSCRIPTION_PLANS;

  return useSupabaseQuery<SubscriptionPlan>(queryKey, 'subscription_plans', {
    select: '*',
    filter: (query) => {
      let q = query.eq('is_active', true).order('price');
      if (cycleId) q = q.eq('cycle_id', cycleId);
      return q;
    },
  });
}

export function usePlanItems(planId: number) {
  return useQuery<SubscriptionPlanItem[]>({
    queryKey: ['plan_items', planId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('plan_items')
        .eq('id', planId)
        .single();
      if (error) throw new Error(error.message);
      if (!data?.plan_items) return [];
      try {
        return JSON.parse(data.plan_items) as SubscriptionPlanItem[];
      } catch {
        return [];
      }
    },
    enabled: !!planId,
    staleTime: 1000 * 60 * 2,
  });
}

// ── User's Active Subscriptions ──

export function useMySubscriptions() {
  const { session } = useAuth();

  return useSupabaseQuery<UserSubscription>(
    [...QUERY_KEYS.SUBSCRIPTIONS],
    () =>
      supabase
        .from('user_subscriptions')
        .select('*, subscription_plans(plan_name, duration_days, cycle_id, price, plan_type, plan_items)')
        .eq('user_id', session?.user.id ?? '')
        .order('created_at', { ascending: false }),
    { enabled: !!session?.user.id }
  );
}

// ── Cancelled/Skipped Days ──

export function useAllCancelledDays(subscriptionIds: number[]) {
  return useSupabaseQuery<CancelledSubscriptionDay>(
    ['cancelled_days_all', ...subscriptionIds],
    () =>
      supabase
        .from('cancelled_subscription_days')
        .select('*')
        .in('subscription_id', subscriptionIds.length > 0 ? subscriptionIds : [-1]),
    { enabled: subscriptionIds.length > 0 }
  );
}

export function useCancelledDays(subscriptionId: number) {
  return useSupabaseQuery<CancelledSubscriptionDay>(
    ['cancelled_days', subscriptionId],
    () =>
      supabase
        .from('cancelled_subscription_days')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .order('cancelled_date'),
  );
}

// ── Skip a Day ──

export interface SkipDayPayload {
  subscription_id: number;
  cancelled_date: string; // YYYY-MM-DD
  cycle_id: number;
  reason?: string;
}

export function useSkipDay() {
  return useSupabaseMutation<SkipDayPayload>(
    (payload) =>
      supabase.from('cancelled_subscription_days').insert({
        subscription_id: payload.subscription_id,
        cancelled_date: payload.cancelled_date,
        cycle_id: payload.cycle_id,
        reason: payload.reason || 'Skipped by customer',
      }),
    [['cancelled_days_all'], ['cancelled_days']]
  );
}

// ── Undo Skip ──

export function useUndoSkip() {
  return useSupabaseMutation<{ id: number }>(
    (payload) =>
      supabase
        .from('cancelled_subscription_days')
        .delete()
        .eq('id', payload.id),
    [['cancelled_days_all'], ['cancelled_days']]
  );
}

// ── Admin: all subscriptions ──

export function useAdminSubscriptions() {
  return useQuery({
    queryKey: ['admin_subscriptions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_subscriptions')
        // BF-21 (2026-05-04): include price in the subscription_plans join.
        // Without it, plan.price was undefined and the proration formula
        // computed ₹0 for every cancellation. Pre-existing query gap that
        // shipped silently from before BF-21 — the new all-inclusive
        // proration formula needs price to produce a non-zero refund.
        .select('*, subscription_plans(plan_name, duration_days, plan_type, price), profiles!user_subscriptions_user_id_fkey(full_name, phone_number)')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/**
 * BF-20 (D-03b, 2026-05-04): atomic cancel + refund.
 *
 * Calls the admin_cancel_subscription_atomic RPC which deactivates the
 * subscription and credits the wallet (if refund > 0) in a single
 * Postgres transaction. Replaces the previous two-step client-side
 * flow that risked "cancelled but not refunded" if the network failed
 * between the two ops.
 *
 * If refundAmount = 0, the subscription is just deactivated (the
 * wallet credit step is a no-op inside the RPC).
 */
export function useAdminCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      subscriptionId,
      refundAmount,
    }: {
      subscriptionId: number;
      refundAmount: number;
    }) => {
      // RPC name cast: database.types.ts is auto-generated and won't
      // know about this RPC until regenerated (task #15, post-launch FT).
      // Same pattern as useStockManager.useAdminAddOrderItem and
      // useCompleteOnboarding.
      const { error } = await supabase.rpc('admin_cancel_subscription_atomic' as never, {
        p_subscription_id: subscriptionId,
        p_refund_amount:   refundAmount,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_subscriptions'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SUBSCRIPTIONS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
    },
  });
}

// ── Pause/Resume Subscription ──

export function usePauseSubscription() {
  const { session } = useAuth();
  return useSupabaseMutation<{ id: number; pause: boolean }>(
    (payload) =>
      supabase
        .from('user_subscriptions')
        .update({ is_paused: payload.pause })
        .eq('id', payload.id)
        .eq('user_id', session?.user.id ?? '')
        .eq('is_active', true),
    [QUERY_KEYS.SUBSCRIPTIONS as unknown as string[]]
  );
}
