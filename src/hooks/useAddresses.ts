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
  zone_id?: number | null;
  hub_id?: number | null;
  is_serviceable?: boolean;
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

export function useSetDefaultAddress() {
  const { session } = useAuth();

  return useSupabaseMutation<number>(
    async (addressId) => {
      const userId = session?.user.id;
      if (!userId) throw new Error('Not authenticated');
      // Clear all existing defaults first
      await supabase
        .from('customer_addresses')
        .update({ is_default: false })
        .eq('user_id', userId);
      // Set the new default
      return supabase
        .from('customer_addresses')
        .update({ is_default: true })
        .eq('id', addressId)
        .eq('user_id', userId);
    },
    [QUERY_KEYS.ADDRESSES as unknown as string[]]
  );
}

export function useDeleteAddress() {
  const { session } = useAuth();

  return useSupabaseMutation<number>(
    (addressId) =>
      supabase
        .from('customer_addresses')
        .update({ is_active: false })
        .eq('id', addressId)
        .eq('user_id', session?.user.id ?? ''),
    [QUERY_KEYS.ADDRESSES as unknown as string[]]
  );
}
