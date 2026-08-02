/**
 * 1stOne F1 — useDeliveryHubs
 *
 * Full CRUD for delivery_hubs. Used by:
 *   - Admin: HubsTab in DeliveryManagerScreen (list + toggle)
 *   - Admin: HubDetailScreen (create / edit)
 *   - ZoneEditorModal (active hubs picker)
 *   - Hub operator: useMyHub, for naming the hub they actually run
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useAuth } from './useAuth';
import { useBranchFilter, requireWriteBranch } from './useBranchFilter';
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

/**
 * The hub this operator runs, or null if they are not one.
 *
 * A hub operator is a customer-role profile with `assigned_hub_id`, so their
 * hub is a claim on the token rather than anything on their own row. Until
 * this existed, their dashboard could only say "My Hub" — a person running one
 * of several hubs had nothing on screen telling them WHICH, which matters the
 * moment there is more than one.
 *
 * Reads `delivery_hubs` directly: it carries public read (catalog block in
 * rls_policies.sql), so no elevated access is involved and no RPC is needed.
 * Deliberately NOT `useDeliveryHubs`, which is branch-filtered for admin
 * screens — an operator has no branch claim and would filter themselves out.
 */
export function useMyHub() {
  const { session } = useAuth();
  const hubId = session?.assignedHubId ?? null;

  return useQuery({
    queryKey: ['my_hub', hubId ?? 'none'],
    queryFn: async (): Promise<{ id: number; hub_name: string } | null> => {
      const { data, error } = await supabase
        .from('delivery_hubs')
        .select('id, hub_name')
        .eq('id', hubId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { id: number; hub_name: string } | null) ?? null;
    },
    enabled: hubId != null,
    // A hub is renamed about never, so there is no reason to re-read it on
    // every screen focus.
    staleTime: QUERY_STALE_TIME * 10,
  });
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
  /** Required — DB column is NOT NULL. Admin form validates non-empty before submit. */
  address_details: string;
  polygon_geojson?: { lat: number; lng: number }[] | null;
  center_lat?: number | null;
  center_lng?: number | null;
  staff_user_id?: string | null;
  staff_name?: string | null;
  staff_phone?: string | null;
  extends_coverage?: boolean;
  branch_id?: number | null;
  driver_code?: string | null;
  driver_user_id?: string | null;
  delivery_fee_override?: number | null;
  commission_percent?: number | null;
}

export function useAddHub() {
  const bf = useBranchFilter();
  return useSupabaseMutation<HubPayload, DeliveryHub>(
    (payload) =>
      supabase.from('delivery_hubs').insert({
        ...payload,
        is_active: true,
        branch_id: payload.branch_id ?? requireWriteBranch(bf),
      }).select().single(),
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

/**
 * Atomically assign (or unassign) a hub's operator.
 * Calls the assign_hub_operator RPC which:
 *   - Clears the previous operator's profiles.assigned_hub_id (if different)
 *   - Sets the new operator's profiles.assigned_hub_id to this hub
 *   - Writes delivery_hubs.staff_user_id
 * Pass p_new_user_id = null to unassign.
 */
export function useAssignHubOperator() {
  return useSupabaseMutation<{ hubId: number; newUserId: string | null; oldUserId: string | null }>(
    (payload) =>
      // RPC param types are string-only; nulls are valid at runtime (unassign)
      // — types don't reflect the SECURITY DEFINER overload.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc('assign_hub_operator', {
        p_hub_id: payload.hubId,
        p_new_user_id: payload.newUserId,
        p_old_user_id: payload.oldUserId,
      }),
    [QUERY_KEYS.HUBS],
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
 * Assigns a hub to all addresses whose coordinates fall within the hub
 * polygon. The point-in-polygon match runs entirely server-side
 * (assign_addresses_to_hub RPC). Returns the count of addresses assigned.
 */
export function useAssignHubAddresses() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (hub: DeliveryHub): Promise<number> => {
      if (!hub.polygon_geojson || hub.polygon_geojson.length < 3) return 0;

      // RPC not yet in the generated database types — cast until regenerated.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('assign_addresses_to_hub', {
        p_hub_id: hub.id,
      });
      if (error) throw new Error(error.message);

      return (data as number) ?? 0;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.HUBS });
    },
  });
}
