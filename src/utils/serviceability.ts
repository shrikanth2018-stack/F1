/**
 * 1stOne F1 — Zone-based Serviceability Check
 *
 * Priority: polygon zones from delivery_zones table.
 * Fallback: radius check from store_config (used before zones are configured).
 * Returns 'serviceable' | 'not_serviceable' | 'unknown'.
 */

import { supabase } from '../api/supabaseClient';

export type ServiceabilityResult = 'serviceable' | 'not_serviceable' | 'unknown';

export interface ZoneCheckResult {
  result: ServiceabilityResult;
  zoneId: number | null;
  zoneName: string | null;
  /** Set when the match came from an extending hub (outside any zone but inside a hub polygon). */
  hubId: number | null;
  hubName: string | null;
}

/** Ray-casting point-in-polygon. Works for geographic coordinates at city scale. */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: { lat: number; lng: number }[]
): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const lati = polygon[i].lat, lngi = polygon[i].lng;
    const latj = polygon[j].lat, lngj = polygon[j].lng;
    const intersect =
      ((lngi > lng) !== (lngj > lng)) &&
      lat < ((latj - lati) * (lng - lngi)) / (lngj - lngi) + lati;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Check if a coordinate falls inside any active delivery zone or an extending hub.
 *
 * Priority:
 *   1. Zone polygons (normal serviceable area) → returns zoneId
 *   2. Hub polygons with extends_coverage=true  → returns hubId only (zoneId null)
 *   3. Nothing matches → not_serviceable
 *
 * The extending-hub path lets admins deliver to pockets outside the zone
 * boundary (e.g. an office cluster across the highway) without redrawing zones.
 */
export async function checkZone(lat: number, lng: number): Promise<ZoneCheckResult> {
  const EMPTY: ZoneCheckResult = { result: 'unknown', zoneId: null, zoneName: null, hubId: null, hubName: null };
  try {
    const [zonesRes, hubsRes] = await Promise.all([
      supabase.from('delivery_zones').select('id, zone_name, polygon_geojson').eq('is_active', true),
      supabase.from('delivery_hubs')
        .select('id, hub_name, polygon_geojson, extends_coverage')
        .eq('is_active', true)
        .eq('extends_coverage', true),
    ]);

    const polygonZones = (zonesRes.data ?? []).filter(
      (z: any) => Array.isArray(z.polygon_geojson) && z.polygon_geojson.length >= 3
    );
    const extendingHubs = (hubsRes.data ?? []).filter(
      (h: any) => Array.isArray(h.polygon_geojson) && h.polygon_geojson.length >= 3
    );

    // 1. Zones first
    for (const zone of polygonZones) {
      if (pointInPolygon(lat, lng, zone.polygon_geojson as { lat: number; lng: number }[])) {
        return {
          result: 'serviceable',
          zoneId: zone.id,
          zoneName: zone.zone_name,
          hubId: null,
          hubName: null,
        };
      }
    }

    // 2. Fallback to extending hubs
    for (const hub of extendingHubs) {
      if (pointInPolygon(lat, lng, hub.polygon_geojson as { lat: number; lng: number }[])) {
        return {
          result: 'serviceable',
          zoneId: null,
          zoneName: null,
          hubId: hub.id,
          hubName: hub.hub_name,
        };
      }
    }

    // 3. If we have any polygon configured, the point simply isn't served.
    // If nothing's configured yet, stay 'unknown' so the app doesn't block orders during setup.
    if (polygonZones.length > 0 || extendingHubs.length > 0) {
      return { result: 'not_serviceable', zoneId: null, zoneName: null, hubId: null, hubName: null };
    }
    return EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Legacy shim — keeps existing callers working without change. */
export async function checkServiceability(lat: number, lng: number): Promise<ServiceabilityResult> {
  const { result } = await checkZone(lat, lng);
  return result;
}
