/**
 * 1stOne F1 — Time Engine
 *
 * ALL time comparisons use SERVER time (from get_server_time() RPC).
 * Schema TIME columns arrive as "HH:MM:SS" strings.
 *
 * RULE: Device clock is NEVER trusted for business logic.
 */

import type { DeliveryCycle } from '../types';

/**
 * Parse "HH:MM" or "HH:MM:SS" string into { hours, minutes }
 */
export function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: h, minutes: m };
}

/**
 * Convert "HH:MM" or "HH:MM:SS" to minutes since midnight
 */
export function timeToMinutes(timeStr: string): number {
  const { hours, minutes } = parseTime(timeStr);
  return hours * 60 + minutes;
}

/**
 * Get server timestamp as minutes since midnight
 */
export function serverTimeToMinutes(serverTimestamp: string): number {
  const date = new Date(serverTimestamp);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Determine dispatch scenario for a delivery cycle.
 *
 * Scenario A: Order placed BEFORE cutoff → dispatched TODAY
 * Scenario B: Order placed AFTER cutoff → dispatched TOMORROW
 *
 * Cross-midnight: If cutoff (e.g. 22:00) > delivery_start (e.g. 07:30),
 * orders after cutoff are Scenario A for NEXT morning.
 */
export function getDispatchScenario(
  cycle: DeliveryCycle,
  serverTimestamp: string
): 'A' | 'B' {
  const nowMinutes = serverTimeToMinutes(serverTimestamp);
  const cutoffMinutes = timeToMinutes(cycle.cutoff_time);
  const deliveryStartMinutes = timeToMinutes(cycle.delivery_start);

  const isCrossMidnight = cutoffMinutes > deliveryStartMinutes;

  if (isCrossMidnight) {
    if (nowMinutes < deliveryStartMinutes) return 'A';
    if (nowMinutes >= deliveryStartMinutes && nowMinutes < cutoffMinutes) return 'B';
    return 'A';
  }

  return nowMinutes < cutoffMinutes ? 'A' : 'B';
}

/**
 * Check if ordering is currently possible for a cycle
 */
export function isCycleOrderable(cycle: DeliveryCycle): boolean {
  return cycle.is_active;
}

/**
 * Get human-readable dispatch label
 */
export function getDispatchLabel(scenario: 'A' | 'B'): string {
  return scenario === 'A' ? 'Today' : 'Tomorrow';
}

/**
 * Format "HH:MM:SS" or "HH:MM" (24h) to "h:mm AM/PM"
 * Returns '—' if timeStr is null/undefined/empty (DB column not populated).
 */
export function formatTime12h(timeStr: string | null | undefined): string {
  if (!timeStr) return '—';
  const { hours, minutes } = parseTime(timeStr);
  if (isNaN(hours) || isNaN(minutes)) return '—';
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${displayHours}:${displayMinutes} ${period}`;
}
