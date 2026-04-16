/**
 * 1stOne F1 — useDeliveryHubs
 *
 * Full CRUD for delivery_hubs. Used by:
 *   - Admin: HubsTab in DeliveryManagerScreen (list + toggle)
 *   - Admin: HubDetailScreen (create / edit)
 *   - ZoneEditorModal (active hubs picker)
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { QUERY_KEYS } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import { pointInPolygon } from '../utils/serviceability';
import type { DeliveryHub } from '../types';

/** All hubs (full fields) — branch-filtered */
export function useDeliveryHubs() {
  const bf = useBranchFilter();
  return useSupabaseQuery<DeliveryHub>(
    [...QUERY_KEYS.HUBS, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let q = supabase
        .from('delivery_hubs')
        .select('*')
        .order('hub_name', { ascending: true });
      if (bf.isActive && bf.branchId != null) {
        q = q.eq('branch_id', bf.branchId);
      }
      return q;
    }
  );
}

/** Active hubs (id + name only) — for zone editor hub picker */
export function useActiveHubs() {
  return useSupabaseQuery<{ id: number; hub_name: string }>(
    [...QUERY_KEYS.HUBS, 'active'],
    () =>
      supabase
        .from('delivery_hubs')
        .select('id, hub_name')
        .eq('is_active', true)
        .order('hub_name')
  );
}

interface HubPayload {
  hub_name: string;
  hub_code?: string | null;
  polygon_geojson?: { lat: number; lng: number }[] | null;
  center_lat?: number | null;
  center_lng?: number | null;
  staff_user_id?: string | null;
  staff_name?: string | null;
  staff_phone?: string | null;
  extends_coverage?: boolean;
  branch_id?: number | null;
}

export function useAddHub() {
  const bf = useBranchFilter();
  return useSupabaseMutation<HubPayload>(
    (payload) =>
      supabase.from('delivery_hubs').insert({
        ...payload,
        is_active: true,
        branch_id: payload.branch_id ?? (bf.isActive ? bf.branchId : null),
      }),
    [QUERY_KEYS.HUBS]
  );
}

export function useUpdateHub() {
  return useSupabaseMutation<{ id: number } & Partial<HubPayload & { is_active: boolean }>>(
    ({ id, ...payload }) =>
      supabase.from('delivery_hubs').update(payload).eq('id', id),
    [QUERY_KEYS.HUBS]
  );
}

export function useToggleHub() {
  return useSupabaseMutation<{ id: number; is_active: boolean }>(
    ({ id, is_active }) =>
      supabase.from('delivery_hubs').update({ is_active }).eq('id', id),
    [QUERY_KEYS.HUBS]
  );
}

/**
 * Returns addresses that will lose delivery coverage when a hub is disabled.
 * Only addresses assigned to this hub with no base zone (zone_id IS NULL).
 */
export function useHubImpactAddresses(hubId: number | null) {
  return useQuery({
    queryKey: ['hub_impact', hubId],
    queryFn: async () => {
      if (hubId == null) return [] as { id: number; user_id: string; label: string }[];
      const { data, error } = await supabase.rpc('get_hub_impact_addresses', { p_hub_id: hubId });
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: number; user_id: string; label: string }[];
    },
    enabled: hubId != null,
    staleTime: 0,
  });
}

/**
 * Assigns a hub to all addresses whose coordinates fall within the hub polygon.
 * Flow: fetch candidates via RPC → client-side ray-cast → batch update via RPC.
 * Returns the count of addresses assigned.
 */
export function useAssignHubAddresses() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (hub: DeliveryHub): Promise<number> => {
      if (!hub.polygon_geojson || hub.polygon_geojson.length < 3) return 0;

      const { data, error } = await supabase.rpc('get_addresses_for_hub_assignment', {
        p_hub_id: hub.id,
      });
      if (error) throw new Error(error.message);

      const matchingIds: number[] = (data ?? [])
        .filter((a: any) => a.latitude != null && a.longitude != null)
        .filter((a: any) => pointInPolygon(a.latitude, a.longitude, hub.polygon_geojson!))
        .map((a: any) => a.id as number);

      if (matchingIds.length === 0) return 0;

      const { error: updateError } = await supabase.rpc('assign_hub_to_address_ids', {
        p_hub_id: hub.id,
        p_address_ids: matchingIds,
      });
      if (updateError) throw new Error(updateError.message);

      return matchingIds.length;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.HUBS });
    },
  });
}
