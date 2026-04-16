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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Check if a coordinate falls inside any active delivery zone.
 * Returns the matching zone's id/name for storage on the address.
 */
export async function checkZone(lat: number, lng: number): Promise<ZoneCheckResult> {
  try {
    const { data: zones } = await supabase
      .from('delivery_zones')
      .select('id, zone_name, polygon_geojson')
      .eq('is_active', true);

    const polygonZones = (zones ?? []).filter(
      (z: any) => Array.isArray(z.polygon_geojson) && z.polygon_geojson.length >= 3
    );

    if (polygonZones.length > 0) {
      for (const zone of polygonZones) {
        if (pointInPolygon(lat, lng, zone.polygon_geojson)) {
          return { result: 'serviceable', zoneId: zone.id, zoneName: zone.zone_name };
        }
      }
      return { result: 'not_serviceable', zoneId: null, zoneName: null };
    }

    // No polygon zones configured yet — return unknown until admin sets them up
    return { result: 'unknown', zoneId: null, zoneName: null };
  } catch {
    return { result: 'unknown', zoneId: null, zoneName: null };
  }
}

/** Legacy shim — keeps existing callers working without change. */
export async function checkServiceability(lat: number, lng: number): Promise<ServiceabilityResult> {
  const { result } = await checkZone(lat, lng);
  return result;
}
