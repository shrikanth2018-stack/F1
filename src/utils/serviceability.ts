/**
 * 1stOne F1 — Address serviceability check.
 *
 * The point-in-polygon serviceability DECISION is server-side — see
 * supabase/sql/serviceability_server_side.sql (resolve_address_serviceability,
 * the single source of the rule). This module only calls that RPC and shapes
 * the result; the device performs no geometry.
 */

import { supabase } from '../api/supabaseClient';

export type ServiceabilityResult = 'serviceable' | 'not_serviceable' | 'unknown';

export interface ZoneCheckResult {
  result: ServiceabilityResult;
  /** True when the point is inside a zone, or inside an extends_coverage hub. */
  isServiceable: boolean;
  zoneId: number | null;
  zoneName: string | null;
  /** Delivery routing hub — any active hub whose polygon contains the point. */
  hubId: number | null;
  hubName: string | null;
}

const EMPTY: ZoneCheckResult = {
  result: 'unknown',
  isServiceable: false,
  zoneId: null,
  zoneName: null,
  hubId: null,
  hubName: null,
};

/**
 * Resolve a coordinate's zone, routing hub, and serviceability via the server.
 * Returns EMPTY ('unknown') on any error so a network blip or mid-setup state
 * never hard-blocks the address form.
 */
export async function checkZone(lat: number, lng: number): Promise<ZoneCheckResult> {
  try {
    // RPC not yet in the generated database types — cast until types are
    // regenerated (same pattern as useStockManager / useAssignHubOperator).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('resolve_address_serviceability', {
      p_lat: lat,
      p_lng: lng,
    });
    if (error || !data || data.length === 0) return EMPTY;
    const row = data[0];
    return {
      result: row.result as ServiceabilityResult,
      isServiceable: row.is_serviceable === true,
      zoneId: row.zone_id ?? null,
      zoneName: row.zone_name ?? null,
      hubId: row.hub_id ?? null,
      hubName: row.hub_name ?? null,
    };
  } catch {
    return EMPTY;
  }
}
