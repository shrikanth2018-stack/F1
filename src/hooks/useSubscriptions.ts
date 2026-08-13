/**
 * 1stOne F1 — useSubscriptions
 *
 * Hooks for subscription plans, user subscriptions,
 * and cancelled/skipped days management.
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseSingle, useSupabaseMutation } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import { useAuth } from './useAuth';
import { useBranchFilter } from './useBranchFilter';
import type {
  SubscriptionPlan,
  SubscriptionPlanItem,
  UserSubscription,
  CancelledSubscriptionDay,
} from '../types';

// ── Available Plans ──
//
// Branch-filtered for customers via useBranchFilter — see MF-09: the
// customer's default address's branch_id drives which branch's plans
// are visible.

export function useSubscriptionPlans(cycleId?: number | null) {
  const bf = useBranchFilter();
  const branchKey = bf.isActive ? bf.branchId ?? 'all' : 'off';
  const queryKey = cycleId
    ? [...QUERY_KEYS.SUBSCRIPTION_PLANS, cycleId, branchKey]
    : [...QUERY_KEYS.SUBSCRIPTION_PLANS, branchKey];

  return useSupabaseQuery<SubscriptionPlan>(queryKey, 'subscription_plans', {
    select: '*',
    filter: (query) => {
      // LISTED PLANS ONLY. A custom plan belongs to the one customer who
      // built it; RLS already hides other people's, but without this a
      // customer would find their own personal plan sitting in the range
      // alongside the ones on offer.
      let q = query.eq('is_active', true).eq('is_custom', false).order('price');
      if (cycleId) q = q.eq('cycle_id', cycleId);
      if (bf.isActive && bf.branchId != null) {
        q = q.eq('branch_id', bf.branchId);
      }
      return q;
    },
  });
}

/**
 * One plan by id, listed or custom.
 *
 * PlanDetailScreen used to find its plan inside the browse list, which meant
 * it could only ever show a plan that was on offer — so a custom plan, which
 * is deliberately absent from that list, would have opened to nothing. RLS
 * decides what may be read; this just asks for the row.
 */
export function usePlanById(planId?: number) {
  return useSupabaseSingle<SubscriptionPlan>(
    [...QUERY_KEYS.SUBSCRIPTION_PLANS, 'by-id', planId ?? 'none'],
    () => supabase.from('subscription_plans').select('*').eq('id', planId!).limit(1),
    { enabled: planId != null },
  );
}

export function usePlanItems(planId: number) {
  return useSupabaseQuery(
    ['plan_items', planId],
    () =>
      supabase.from('subscription_plans').select('plan_items').eq('id', planId).single(),
    {
      enabled: !!planId,
      staleTime: 1000 * 60 * 2,
      transform: (rows: Array<{ plan_items?: string | null }>): SubscriptionPlanItem[] => {
        const raw = rows[0]?.plan_items;
        if (!raw) return [];
        try {
          return JSON.parse(raw) as SubscriptionPlanItem[];
        } catch {
          return [];
        }
      },
    },
  );
}

// ── User's Active Subscriptions ──

export function useMySubscriptions() {
  const { session } = useAuth();

  return useSupabaseQuery<UserSubscription>(
    [...QUERY_KEYS.SUBSCRIPTIONS],
    () =>
      supabase
        .from('user_subscriptions')
        // `is_custom` is here for the plan builder: the server allows ONE
        // running custom plan per cycle, and that refusal used to arrive on
        // the final button after everything had been chosen. With the flag on
        // the row, the builder can grey the cycle out at the first question.
        .select('*, subscription_plans(plan_name, duration_days, cycle_id, price, plan_type, plan_items, is_custom)')
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useSupabaseQuery<any>(
    ['admin_subscriptions'],
    () =>
      supabase
        .from('user_subscriptions')
        // BF-21 (2026-05-04): include price in the subscription_plans join.
        // Without it, plan.price was undefined and the proration formula
        // computed ₹0 for every cancellation. The all-inclusive proration
        // formula needs price to produce a non-zero refund.
        .select('*, subscription_plans(plan_name, duration_days, plan_type, price), profiles!user_subscriptions_user_id_fkey(full_name, phone_number)')
        .eq('is_active', true)
        .order('created_at', { ascending: false }),
  );
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
  return useSupabaseMutation<{ subscriptionId: number; refundAmount: number }>(
    (payload) =>
      // RPC not in the generated types — cast (same pattern as useStockManager).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc('admin_cancel_subscription_atomic', {
        p_subscription_id: payload.subscriptionId,
        p_refund_amount: payload.refundAmount,
      }),
    [['admin_subscriptions'], QUERY_KEYS.SUBSCRIPTIONS, QUERY_KEYS.WALLET],
  );
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
