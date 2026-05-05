/**
 * 1stOne F1 — useCompleteOnboarding
 *
 * Atomic first-time onboarding for new customers. Wraps the
 * complete_onboarding_atomic SQL RPC, which writes the profile
 * full_name and the user's first delivery address in a single
 * PostgreSQL transaction (both succeed or neither does).
 *
 * Used only by the post-OTP onboarding screen. Existing-customer
 * additional-address flow continues to use useAddAddress.
 *
 * The server-side RPC enforces auth.uid() = p_user_id, so a
 * caller cannot onboard a different user even if the client
 * code passes a wrong id.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS } from '../utils/constants';

export interface CompleteOnboardingPayload {
  user_id: string;
  phone_number: string;
  full_name: string;
  label: string;
  address_line: string;
  landmark: string | null;
  city: string | null;
  pincode: string | null;
  latitude: number;
  longitude: number;
  zone_id: number | null;
  hub_id: number | null;
  is_serviceable: boolean;
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CompleteOnboardingPayload) => {
      const { data, error } = await supabase.rpc('complete_onboarding_atomic', {
        p_user_id:        payload.user_id,
        p_phone_number:   payload.phone_number,
        p_full_name:      payload.full_name,
        p_label:          payload.label,
        p_address_line:   payload.address_line,
        p_landmark:       payload.landmark,
        p_city:           payload.city,
        p_pincode:        payload.pincode,
        p_latitude:       payload.latitude,
        p_longitude:      payload.longitude,
        p_zone_id:        payload.zone_id,
        p_hub_id:         payload.hub_id,
        p_is_serviceable: payload.is_serviceable,
      });
      if (error) throw new Error(error.message);
      return data as number;  // new address id
    },
    onSuccess: async () => {
      // Picks up the freshly-written profiles.branch_id so subsequent
      // branch-aware reads (catalog, plans, banners) see the right branch
      // without waiting for the next foreground refresh (~1h).
      await supabase.auth.refreshSession();
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ADDRESSES });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
    },
  });
}
