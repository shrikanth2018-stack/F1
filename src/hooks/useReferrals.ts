/**
 * 1stOne F1 — useReferrals
 *
 * Referral program — Earn While They Subscribe model:
 *
 * 1. Referee enters referrer's code → referee gets signup_credit immediately
 * 2. Referee places first order → referrer gets first_order_points + first_order_credit
 * 3. After 30 days (admin triggers) → referrer gets month_credit bonus
 *
 * Milestones: N friends ordered = Star badge, M friends = Ambassador badge.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { Referral, ReferralSettings, Profile } from '../types';

// ── Defaults if columns don't exist in DB yet ──────────────
export const REFERRAL_DEFAULTS: Partial<ReferralSettings> = {
  is_active: false,
  referee_signup_credit: 50,
  referee_reward_points: 0,
  referrer_first_order_points: 100,
  referrer_first_order_credit: 30,
  referrer_month_credit: 100,
  milestone_star_count: 3,
  milestone_ambassador_count: 5,
};

export function mergedSettings(raw: Partial<ReferralSettings> | null): ReferralSettings {
  return { ...REFERRAL_DEFAULTS, ...raw } as ReferralSettings;
}

// ── Customer hooks ───────────────────────────────────────────

export function useMyReferralCode() {
  const { session } = useAuth();
  return useQuery({
    queryKey: [...QUERY_KEYS.PROFILE, 'referral_code', session?.user.id],
    queryFn: async () => {
      if (!session) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('referral_code')
        .eq('id', session.user.id)
        .single();
      if (error) throw error;
      return data?.referral_code as string | null;
    },
    enabled: !!session,
    staleTime: QUERY_STALE_TIME,
  });
}

export function useReferralSettings() {
  return useQuery({
    queryKey: ['referral_settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referral_settings')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return mergedSettings(data as any);
    },
    staleTime: QUERY_STALE_TIME,
  });
}

export function useMyReferrals() {
  const { session } = useAuth();
  return useQuery({
    queryKey: [...QUERY_KEYS.REFERRALS, session?.user.id],
    queryFn: async () => {
      if (!session) return [];
      const { data, error } = await supabase
        .from('referrals')
        .select('*, profiles!referrals_referee_id_fkey(full_name, phone_number)')
        .eq('referrer_id', session.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as (Referral & { profiles: Pick<Profile, 'full_name' | 'phone_number'> | null })[];
    },
    enabled: !!session,
    staleTime: QUERY_STALE_TIME,
  });
}

export function useGenerateReferralCode() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Not authenticated');
      const code = '1ST' + session.user.id.slice(0, 6).toUpperCase();
      const { error } = await supabase
        .from('profiles')
        .update({ referral_code: code })
        .eq('id', session.user.id);
      if (error) throw error;
      return code;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE }),
  });
}

/** Apply referral code — validated and credited server-side via Edge Function */
export function useApplyReferralCode() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      if (!session) throw new Error('Not authenticated');

      const { data: { session: rawSession } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('apply-referral', {
        headers: { Authorization: `Bearer ${rawSession?.access_token}` },
        body: { code },
      });

      if (error || data?.error) {
        // Extract the server-side error message
        let message = 'Failed to apply referral code';
        try {
          if (data?.error) {
            message = data.error;
          } else {
            const ctx = (error as any)?.context;
            if (ctx) {
              const text = await (ctx.clone ? ctx.clone() : ctx).text();
              const parsed = JSON.parse(text);
              if (parsed?.error) message = parsed.error;
            }
          }
        } catch {}
        throw new Error(message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REFERRALS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
    },
  });
}

/**
 * Call after a customer places their first order.
 * Checks if they were referred; if so, credits the referrer's first-order bonus.
 * Safe to call on every order — checks reward_given flag.
 */
export async function checkAndGrantFirstOrderBonus(userId: string): Promise<void> {
  // Get user's referred_by
  const { data: profile } = await supabase
    .from('profiles')
    .select('referred_by')
    .eq('id', userId)
    .single();
  if (!profile?.referred_by) return;

  // Find the referral record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: referral } = await (supabase as any)
    .from('referrals')
    .select('id, status, first_order_reward_given')
    .eq('referee_id', userId)
    .eq('referrer_id', profile.referred_by)
    .maybeSingle() as { data: { id: number; status: string | null; first_order_reward_given: boolean | null } | null };
  if (!referral || referral.first_order_reward_given) return;

  // Get settings
  const { data: rawSettings } = await supabase
    .from('referral_settings')
    .select('*').limit(1).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings = mergedSettings(rawSettings as any);
  if (!settings.is_active) return;

  // Count referee's orders
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('status', 'Cancelled');
  if ((count ?? 0) !== 1) return; // only trigger on first order

  // Credit referrer
  if (settings.referrer_first_order_credit > 0) {
    await creditWallet(
      profile.referred_by,
      settings.referrer_first_order_credit,
      `Referral bonus — your friend placed their first order`
    );
  }
  if (settings.referrer_first_order_points > 0) {
    await creditLoyaltyPoints(profile.referred_by, settings.referrer_first_order_points);
  }

  // Update referral record — first_order_reward_given column needs migration (see supabase/sql/referrals_reward_columns.sql)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('referrals')
    .update({ status: 'first_order_done', first_order_reward_given: true, reward_given: true })
    .eq('id', referral.id);
}

// ── Admin hooks ──────────────────────────────────────────────

export function useAllReferrals() {
  return useQuery({
    queryKey: ['admin_referrals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referrals')
        .select(`
          *,
          referrer:profiles!referrals_referrer_id_fkey(full_name, phone_number),
          referee:profiles!referrals_referee_id_fkey(full_name, phone_number)
        `)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

export function useUpdateReferralSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<ReferralSettings>) => {
      // Upsert — referral_settings is a single-row config table
      const { data: existing } = await supabase
        .from('referral_settings')
        .select('id')
        .limit(1)
        .maybeSingle();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      if (existing?.id) {
        const { error } = await db
          .from('referral_settings')
          .update({ ...settings, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) throw new Error((error as { message: string }).message);
      } else {
        const { error } = await db
          .from('referral_settings')
          .insert({ ...REFERRAL_DEFAULTS, ...settings });
        if (error) throw new Error((error as { message: string }).message);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['referral_settings'] }),
  });
}

/** Admin manually issues the month completion bonus for a referral */
export function useIssueMonthBonus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ referralId, referrerId }: { referralId: number; referrerId: string }) => {
      const { data: rawSettings } = await supabase
        .from('referral_settings')
        .select('*').limit(1).maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings = mergedSettings(rawSettings as any);

      if (settings.referrer_month_credit > 0) {
        await creditWallet(
          referrerId,
          settings.referrer_month_credit,
          'Referral bonus — friend completed first month'
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('referrals')
        .update({ status: 'month_complete', month_reward_given: true })
        .eq('id', referralId);
      if (error) throw new Error((error as { message: string }).message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_referrals'] }),
  });
}

// ── Helpers ──────────────────────────────────────────────────

async function creditWallet(userId: string, amount: number, description: string): Promise<void> {
  const { error } = await supabase.rpc('increment_wallet_balance', {
    p_user_id: userId,
    p_amount: amount,
    p_description: description,
  });
  if (error) throw new Error(`increment_wallet_balance failed: ${error.message}`);
}

async function creditLoyaltyPoints(userId: string, points: number): Promise<void> {
  const { error } = await supabase.rpc('increment_loyalty_points', {
    p_user_id: userId,
    p_points: points,
  });
  if (error) throw new Error(`increment_loyalty_points failed: ${error.message}`);
}
