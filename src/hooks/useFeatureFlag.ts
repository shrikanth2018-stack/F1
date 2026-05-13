/**
 * 1stOne F1 — useFeatureFlag
 *
 * Reads feature flags from Supabase.
 * Used to toggle modules without code deploy:
 * - essentials (grocery module)
 * - hub_delivery (hub routing)
 * - branch_management (multi-branch)
 * - referral_system
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
 * Check a single feature flag by key name.
 *
 * `defaultValue` is returned when the flags table hasn't loaded yet OR the
 * flag row is missing. Pass `true` for intrinsic modules that should be on
 * until an admin explicitly disables them (e.g. essentials_module_active);
 * pass `false` (default) for opt-in modules (hub_delivery_active,
 * branch_management_active) that must be explicitly enabled.
 */
export function useFeatureFlag(flagKey: string, defaultValue = false): boolean {
  const { data: flags } = useFeatureFlags();
  if (!flags) return defaultValue;
  const flag = flags.find((f) => f.flag_key === flagKey);
  return flag?.flag_value ?? defaultValue;
}
