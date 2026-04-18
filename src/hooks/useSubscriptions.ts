/**
 * 1stOne F1 — useSubscriptions
 *
 * Hooks for subscription plans, user subscriptions,
 * and cancelled/skipped days management.
 */

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
  return useSupabaseQuery<SubscriptionPlanItem>(
    ['subscription_plan_items', planId],
    () =>
      supabase
        .from('subscription_plan_items')
        .select('*, menu_items(name, price)')
        .eq('plan_id', planId),
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
        .select('*, subscription_plans(plan_name, duration_days, cycle_id, price, plan_type)')
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

// ── Subscribe to a Plan ──

export interface SubscribePayload {
  plan_id: number;
  payment_method: 'wallet' | 'razorpay';
  start_date: string; // YYYY-MM-DD
}

export function useSubscribe() {
  const { session } = useAuth();

  return useSupabaseMutation<SubscribePayload>(
    async (payload) => {
      const { data, error } = await supabase.functions.invoke('subscribe', {
        headers: {
          'Idempotency-Key': `${session?.user.id}-${payload.plan_id}-${payload.start_date}`,
        },
        body: {
          ...payload,
          user_id: session?.user.id,
        },
      });

      if (error) {
        return { data: null, error, count: null, status: 500, statusText: 'Error' } as any;
      }
      return { data, error: null, count: null, status: 200, statusText: 'OK' } as any;
    },
    [QUERY_KEYS.SUBSCRIPTIONS as unknown as string[]]
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

// ── Pause/Resume Subscription ──

export function usePauseSubscription() {
  const { session } = useAuth();
  return useSupabaseMutation<{ id: number; pause: boolean }>(
    (payload) =>
      supabase
        .from('user_subscriptions')
        .update({ is_paused: payload.pause })
        .eq('id', payload.id)
        .eq('user_id', session?.user.id ?? ''),
    [QUERY_KEYS.SUBSCRIPTIONS as unknown as string[]]
  );
}
