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
 * Same-day cycle (cutoff before delivery on the same calendar day):
 *   Scenario A — order placed BEFORE cutoff → dispatched TODAY.
 *   Scenario B — order placed AFTER cutoff  → dispatched TOMORROW.
 *
 * Cross-midnight cycle (cutoff > delivery_start, e.g. Breakfast with
 * cutoff 22:30 tonight for delivery 07:30 tomorrow):
 *   Today's delivery was locked at yesterday's cutoff — never available
 *   for fresh ordering. Only valid scenarios:
 *   Scenario B — order placed BEFORE today's cutoff → tomorrow morning.
 *   Scenario C — order placed AFTER today's cutoff  → day after tomorrow
 *                (BF-41 / F3.X: customer sees a consent popup at checkout
 *                acknowledging the 2-day shift).
 */
export type DispatchScenario = 'A' | 'B' | 'C';

export function getDispatchScenario(
  cycle: DeliveryCycle,
  serverTimestamp: string
): DispatchScenario {
  const nowMinutes = serverTimeToMinutes(serverTimestamp);
  const cutoffMinutes = timeToMinutes(cycle.cutoff_time);
  const deliveryStartMinutes = timeToMinutes(cycle.delivery_start);

  const isCrossMidnight = cutoffMinutes > deliveryStartMinutes;

  if (isCrossMidnight) {
    // Today's delivery already locked; pick the next available cycle iteration.
    return nowMinutes < cutoffMinutes ? 'B' : 'C';
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
export function getDispatchLabel(scenario: DispatchScenario): string {
  switch (scenario) {
    case 'A': return 'Today';
    case 'B': return 'Tomorrow';
    case 'C': return 'Day after tomorrow';
  }
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
