/**
 * 1stOne F1 — useHubCommission
 *
 * Hub operator's monthly commission: summary (server-computed via
 * get_hub_commission_summary), claim action (create_hub_commission_claim,
 * server-priced — the client never sends an amount), and the operator's
 * own claim history (expense_claims, category 'Hub Commission').
 *
 * Claims ride the existing admin flow: Pending → Approved → Paid
 * (Expense Manager). One claim per hub per calendar month, enforced by a
 * DB unique index.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useAuth } from './useAuth';
import type { ExpenseClaim } from '../types';

export interface HubCommissionPeriod {
  period_start: string;
  label: string;
  delivered_orders: number;
  base_amount: number;
  commission: number;
}

export interface HubCommissionSummary {
  hub_id: number;
  hub_name: string;
  commission_percent: number;
  last_month: HubCommissionPeriod & {
    claimed: boolean;
    claim_status: ExpenseClaim['status'] | null;
    claim_amount: number | null;
  };
  current_month: HubCommissionPeriod & { as_of: string };
}

/** Server-computed commission summary for the caller's hub. */
export function useHubCommissionSummary() {
  const { session } = useAuth();
  return useQuery({
    queryKey: [...QUERY_KEYS.HUB_COMMISSION, 'summary'],
    queryFn: async () => {
      // RPC post-dates the generated types — cast (MF-08 pattern).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_hub_commission_summary');
      if (error) throw new Error(error.message);
      return data as HubCommissionSummary;
    },
    enabled: session?.assignedHubId != null,
    staleTime: QUERY_STALE_TIME,
  });
}

/** The operator's own commission claims, newest first. */
export function useMyHubCommissionClaims() {
  const { session } = useAuth();
  return useSupabaseQuery<ExpenseClaim>(
    [...QUERY_KEYS.HUB_COMMISSION, 'claims'],
    () =>
      supabase
        .from('expense_claims')
        .select('*')
        .eq('staff_id', session?.user.id ?? '')
        .eq('category', 'Hub Commission')
        .order('created_at', { ascending: false })
        .limit(24),
    { enabled: session?.assignedHubId != null, staleTime: QUERY_STALE_TIME },
  );
}

/** Claim last month's commission. Amount is computed server-side. */
export function useClaimHubCommission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // RPC post-dates the generated types — cast (MF-08 pattern).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('create_hub_commission_claim');
      if (error) throw new Error(error.message);
      return data as { claim_id: number; period: string; amount: number; status: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.HUB_COMMISSION });
      // Admin's Expense Manager list — refresh if an admin is on a shared device.
      queryClient.invalidateQueries({ queryKey: ['admin_expense_claims'] });
    },
  });
}
