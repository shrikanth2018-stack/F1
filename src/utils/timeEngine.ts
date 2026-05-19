/**
 * 1stOne F1 — Time display & parsing helpers.
 *
 * Pure presentation utilities only. The dispatch DECISION — which scenario a
 * cycle is in right now — is server-authoritative: see the cycle-dispatch
 * Edge Function, useCycleDispatch, and supabase/functions/_shared/dispatch.ts
 * (the single dispatch rule, also used by quote-order / place-order). This
 * module never decides scheduling; it only parses and formats time strings.
 */

/** Parse "HH:MM" or "HH:MM:SS" into { hours, minutes }. */
export function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: h, minutes: m };
}

/**
 * Convert "HH:MM" or "HH:MM:SS" to minutes since midnight. Returns 0 for a
 * missing or unparseable value (callers sort/compare, so 0 is a safe floor).
 */
export function timeToMinutes(timeStr: string | null | undefined): number {
  if (!timeStr) return 0;
  const { hours, minutes } = parseTime(timeStr);
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

/** Dispatch scenario letter — decided server-side, labelled here. */
export type DispatchScenario = 'A' | 'B' | 'C';

/** Human-readable label for a server-derived dispatch scenario. */
export function getDispatchLabel(scenario: DispatchScenario): string {
  switch (scenario) {
    case 'A': return 'Today';
    case 'B': return 'Tomorrow';
    case 'C': return 'Day after tomorrow';
  }
}

/**
 * Format "HH:MM:SS" or "HH:MM" (24h) to "h:mm AM/PM".
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
