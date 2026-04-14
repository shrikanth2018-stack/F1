/**
 * 1stOne F1 — Serviceability Check
 *
 * Checks if a lat/lng coordinate is within the store's service area.
 * Reads service_center_lat, service_center_lng, service_radius_km from store_config.
 * Returns 'serviceable' | 'not_serviceable' | 'unknown' (if config not set).
 */

import { supabase } from '../api/supabaseClient';

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

export type ServiceabilityResult = 'serviceable' | 'not_serviceable' | 'unknown';

export async function checkServiceability(
  lat: number,
  lng: number
): Promise<ServiceabilityResult> {
  try {
    const { data } = await supabase
      .from('store_config')
      .select('service_center_lat, service_center_lng, service_radius_km')
      .limit(1)
      .single();

    const centerLat = (data as any)?.service_center_lat;
    const centerLng = (data as any)?.service_center_lng;
    const radiusKm = (data as any)?.service_radius_km;

    if (centerLat == null || centerLng == null || radiusKm == null) return 'unknown';

    const dist = haversineKm(lat, lng, centerLat, centerLng);
    return dist <= radiusKm ? 'serviceable' : 'not_serviceable';
  } catch {
    return 'unknown';
  }
}
