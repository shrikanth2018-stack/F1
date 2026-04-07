/**
 * 1stOne F1 — useReferrals
 *
 * Referral system hooks:
 * - Get own referral code
 * - Fetch referral history (people I referred)
 * - Fetch referral settings (reward amounts)
 * - Apply referral code (referee side)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { Referral, ReferralSettings, Profile } from '../types';

/** Get current user's referral code from profile */
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

/** Fetch referral settings (reward config) */
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
      return data as ReferralSettings | null;
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Fetch my referral history (people I referred) */
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
      return (data ?? []) as (Referral & { profiles: any })[];
    },
    enabled: !!session,
    staleTime: QUERY_STALE_TIME,
  });
}

/** Generate a referral code for current user if they don't have one */
export function useGenerateReferralCode() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Not authenticated');

      // Generate a short code from user ID
      const code = '1ST' + session.user.id.slice(0, 6).toUpperCase();

      const { error } = await supabase
        .from('profiles')
        .update({ referral_code: code })
        .eq('id', session.user.id);

      if (error) throw error;
      return code;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
    },
  });
}

/** Apply a referral code (referee enters referrer's code) */
export function useApplyReferralCode() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (code: string) => {
      if (!session) throw new Error('Not authenticated');

      // Find the referrer by code
      const { data: referrer, error: findErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('referral_code', code.toUpperCase())
        .single();

      if (findErr || !referrer) throw new Error('Invalid referral code');
      if (referrer.id === session.user.id) throw new Error('Cannot use your own code');

      // Check if already referred
      const { data: existing } = await supabase
        .from('referrals')
        .select('id')
        .eq('referee_id', session.user.id)
        .limit(1);

      if (existing && existing.length > 0) throw new Error('You have already used a referral code');

      // Create referral record
      const { error: refErr } = await supabase.from('referrals').insert({
        referrer_id: referrer.id,
        referee_id: session.user.id,
        status: 'completed',
        reward_given: false,
      });

      if (refErr) throw refErr;

      // Update profile with referred_by
      await supabase
        .from('profiles')
        .update({ referred_by: referrer.id })
        .eq('id', session.user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REFERRALS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
    },
  });
}
