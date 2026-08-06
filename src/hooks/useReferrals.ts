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
import { invokeFunction } from '../api/invokeFunction';
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

function mergedSettings(raw: Partial<ReferralSettings> | null): ReferralSettings {
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
      await invokeFunction('apply-referral', { code }, {
        fallbackMessage: 'Failed to apply referral code',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REFERRALS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
    },
  });
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

      // Local ReferralSettings type has reward-tier columns that the DB table
      // doesn't have yet (pending migration). Cast preserves runtime contract.
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

/**
 * Admin manually issues the month completion bonus for a referral.
 *
 * ONE SERVER CALL, not three. This used to read the settings, credit the
 * wallet, and then mark the referral — from a phone, over three round-trips,
 * with money moving in the middle one. A failure after the credit paid the
 * referrer and left the row unmarked, so pressing again paid them twice.
 *
 * `admin_issue_referral_month_bonus` does all of it inside one transaction,
 * locks the row so two admins cannot both pay, and refuses a referral that
 * has already been settled. It is also the reason the raw
 * `increment_wallet_balance` RPC no longer needs to be reachable from a
 * client at all — see supabase/sql/lock_down_definer_functions.sql.
 *
 * `referrerId` is still accepted so the calling screen did not have to
 * change; the server reads the referrer from the referral row rather than
 * trusting what the client sent, which is the point.
 */
export function useIssueMonthBonus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ referralId }: { referralId: number; referrerId?: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('admin_issue_referral_month_bonus', {
        p_referral_id: referralId,
      });
      if (error) throw new Error((error as { message: string }).message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_referrals'] }),
  });
}

// ── Helpers ──────────────────────────────────────────────────
//
// `creditWallet` lived here and called `increment_wallet_balance` straight
// from the client. It was the LAST client caller of that RPC, which is why
// the RPC could not be locked to the server while it existed. Its one user
// (useIssueMonthBonus, above) now goes through an admin-gated RPC that does
// the credit and the bookkeeping in a single transaction, so this is gone
// and the money function is server-side only. Do not reintroduce it: a
// wallet must never be movable by anything the client can call directly.
