/**
 * 1stOne F1 — useExpenses
 *
 * Staff expense claim hooks:
 * - Fetch my expense claims
 * - Submit new expense claim
 * - Offline-aware submission
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { useStaffQueueStore } from '../store/staffQueueStore';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { ExpenseClaim } from '../types';

export type ExpenseCategory = 'Grocery' | 'Vegetable' | 'Stationery' | 'Fuel' | 'Others';

/** Fetch current staff's expense claims */
export function useMyExpenses() {
  const { session } = useAuth();

  return useQuery({
    queryKey: [...QUERY_KEYS.EXPENSE_CLAIMS, session?.user.id],
    queryFn: async () => {
      if (!session) return [];

      const { data, error } = await supabase
        .from('expense_claims')
        .select('*')
        .eq('staff_id', session.user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as ExpenseClaim[];
    },
    enabled: !!session,
    staleTime: QUERY_STALE_TIME,
  });
}

/** Submit a new expense claim (offline-aware) */
export function useSubmitExpense() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const enqueue = useStaffQueueStore((s) => s.enqueue);

  return useMutation({
    mutationFn: async ({
      category,
      description,
      amount,
    }: {
      category: ExpenseCategory;
      description: string;
      amount: number;
    }) => {
      if (!session) throw new Error('Not authenticated');

      const payload = {
        staff_id: session.user.id,
        category,
        description,
        amount,
        status: 'Pending',
      };

      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected && netState.isInternetReachable !== false;

      if (isOnline) {
        const { error } = await supabase.from('expense_claims').insert(payload);
        if (error) throw error;
      } else {
        enqueue({
          table: 'expense_claims',
          operation: 'insert',
          payload,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.EXPENSE_CLAIMS });
    },
  });
}
