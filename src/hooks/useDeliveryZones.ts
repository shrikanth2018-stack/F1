/**
 * 1stOne F1 — useDeliveryZones
 *
 * CRUD hooks for delivery_zones. Used by:
 *   - Admin: ZoneEditorTab in DeliveryManagerScreen (draw + manage zones)
 *   - Serviceability: checkZone() reads zones directly via Supabase client
 * Filtered by branch when branch_management_active is on.
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { DeliveryZone } from '../types';

export function useDeliveryZones() {
  const bf = useBranchFilter();

  return useSupabaseQuery<DeliveryZone>(
    [...QUERY_KEYS.ZONES, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let q = supabase
        .from('delivery_zones')
        .select('*')
        .order('zone_name', { ascending: true });
      if (bf.isActive && bf.branchId != null) {
        q = q.eq('branch_id', bf.branchId);
      }
      return q;
    }
  );
}

interface ZonePayload {
  zone_name: string;
  description?: string | null;
  delivery_fee_override?: number | null;
  hub_id?: number | null;
  polygon_geojson: { lat: number; lng: number }[];
  branch_id?: number | null;
}

export function useAddZone() {
  const bf = useBranchFilter();
  return useSupabaseMutation<ZonePayload>(
    (payload) =>
      supabase.from('delivery_zones').insert({
        ...payload,
        is_active: true,
        branch_id: payload.branch_id ?? (bf.isActive ? bf.branchId : null),
      }),
    [QUERY_KEYS.ZONES as unknown as string[]]
  );
}

export function useUpdateZone() {
  return useSupabaseMutation<{ id: number } & Partial<ZonePayload & { is_active: boolean }>>(
    ({ id, ...payload }) =>
      supabase.from('delivery_zones').update(payload).eq('id', id),
    [QUERY_KEYS.ZONES as unknown as string[]]
  );
}

export function useDeleteZone() {
  return useSupabaseMutation<{ id: number }>(
    ({ id }) => supabase.from('delivery_zones').delete().eq('id', id),
    [QUERY_KEYS.ZONES as unknown as string[]]
  );
}
