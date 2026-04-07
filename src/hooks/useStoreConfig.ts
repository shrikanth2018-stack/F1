/**
 * 1stOne F1 — useStoreConfig
 *
 * Fetches the singleton store configuration row.
 * Contains: store_name, tagline, whatsapp_support_number,
 * min_order_amount, delivery_charge, free_delivery_above, tax_percent, etc.
 *
 * Cached aggressively — changes rarely.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS } from '../utils/constants';
import type { StoreConfig } from '../types';

async function fetchStoreConfig(): Promise<StoreConfig> {
  const { data, error } = await supabase
    .from('store_config')
    .select('*')
    .limit(1)
    .single();

  if (error) throw error;
  return data as StoreConfig;
}

export function useStoreConfig() {
  return useQuery({
    queryKey: QUERY_KEYS.STORE_CONFIG,
    queryFn: fetchStoreConfig,
    staleTime: 5 * 60 * 1000, // 5 minutes — config rarely changes
  });
}
