/**
 * 1stOne F1 — useFeatureFlag
 *
 * Reads feature flags from Supabase.
 * Used to toggle modules without code deploy:
 * - essentials (grocery module)
 * - hub_delivery (hub routing)
 * - branch_management (multi-branch)
 * - loyalty_program
 * - referral_system
 * - route_pdf_generation
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS } from '../utils/constants';
import type { FeatureFlag } from '../types';

async function fetchFeatureFlags(): Promise<FeatureFlag[]> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('*');

  if (error) throw error;
  return data as FeatureFlag[];
}

/**
 * Get all feature flags
 */
export function useFeatureFlags() {
  return useQuery({
    queryKey: QUERY_KEYS.FEATURE_FLAGS,
    queryFn: fetchFeatureFlags,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Check a single feature flag by key name
 */
export function useFeatureFlag(flagKey: string): boolean {
  const { data: flags } = useFeatureFlags();
  if (!flags) return false;
  const flag = flags.find((f) => f.flag_key === flagKey);
  return flag?.flag_value ?? false;
}
