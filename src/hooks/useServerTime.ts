/**
 * 1stOne F1 — useServerTime
 *
 * Fetches server time from Supabase RPC (get_server_time).
 * Used by Smart Cart Engine to evaluate dispatch scenarios.
 * Refreshes every 60 seconds to stay in sync.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS } from '../utils/constants';

async function fetchServerTime(): Promise<string> {
  const { data, error } = await supabase.rpc('get_server_time');
  if (error) throw error;
  return data as string;
}

export function useServerTime() {
  return useQuery({
    queryKey: QUERY_KEYS.SERVER_TIME,
    queryFn: fetchServerTime,
    refetchInterval: 60_000, // Re-sync every minute
    staleTime: 30_000,
  });
}
