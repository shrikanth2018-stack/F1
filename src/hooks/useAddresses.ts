/**
 * 1stOne F1 — useAddresses
 *
 * Fetches customer delivery addresses.
 * Also provides mutation to add/update addresses.
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import { useAuth } from './useAuth';
import type { CustomerAddress } from '../types';

export function useAddresses() {
  const { session } = useAuth();

  return useSupabaseQuery<CustomerAddress>(
    QUERY_KEYS.ADDRESSES,
    () =>
      supabase
        .from('customer_addresses')
        .select('*')
        .eq('user_id', session?.user.id ?? '')
        .eq('is_active', true)
        .order('is_default', { ascending: false }),
    { enabled: !!session?.user.id }
  );
}

interface AddAddressPayload {
  label: string;
  full_name: string;
  address_line: string;
  landmark?: string;
  city?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  is_default?: boolean;
}

export function useAddAddress() {
  const { session } = useAuth();

  return useSupabaseMutation<AddAddressPayload>(
    (payload) =>
      supabase.from('customer_addresses').insert({
        ...payload,
        user_id: session?.user.id,
      }),
    [QUERY_KEYS.ADDRESSES as unknown as string[]]
  );
}
