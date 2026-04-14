/**
 * 1stOne F1 — useWallet
 *
 * Wallet hooks:
 * - Fetch wallet balance (from profile)
 * - Transaction history
 * - Top-up via Razorpay (creates Razorpay order, waits for payment, credits wallet)
 *
 * Wallet top-up flow:
 * 1. Client calls Edge Function to create Razorpay order
 * 2. Razorpay checkout opens on device
 * 3. Razorpay webhook confirms payment → server credits wallet
 * 4. Client polls for updated balance
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { WalletTransaction } from '../types';

/** Fetch wallet balance from profile */
export function useWalletBalance() {
  const { session } = useAuth();

  return useQuery({
    queryKey: [...QUERY_KEYS.WALLET, 'balance', session?.user.id],
    queryFn: async () => {
      if (!session) return { balance: 0, loyaltyPoints: 0, fullName: '' };

      const { data, error } = await supabase
        .from('profiles')
        .select('wallet_balance, loyalty_points, full_name')
        .eq('id', session.user.id)
        .single();

      if (error) throw error;
      return {
        balance: data?.wallet_balance ?? 0,
        loyaltyPoints: data?.loyalty_points ?? 0,
        fullName: data?.full_name ?? '',
      };
    },
    enabled: !!session,
    staleTime: 30 * 1000, // 30s — balance changes often
  });
}

/** Fetch wallet transaction history */
export function useWalletTransactions() {
  const { session } = useAuth();

  return useQuery({
    queryKey: [...QUERY_KEYS.WALLET, 'transactions', session?.user.id],
    queryFn: async () => {
      if (!session) return [];

      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data ?? []) as WalletTransaction[];
    },
    enabled: !!session,
    staleTime: QUERY_STALE_TIME,
  });
}

/** Initiate wallet top-up (creates Razorpay order via Edge Function) */
export function useWalletTopup() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (amount: number) => {
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('wallet-topup', {
        body: { amount },
      });

      if (error) throw error;
      return data as { razorpay_order_id: string; amount: number };
    },
    onSuccess: () => {
      // Invalidate after successful Razorpay payment is confirmed via webhook
      // Client should call refetchBalance() after Razorpay checkout closes
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
    },
  });
}

/** Manual balance refresh (call after Razorpay checkout closes) */
export function useRefreshWallet() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
  };
}
