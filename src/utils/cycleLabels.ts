/**
 * 1stOne F1 — Cycle label mapping
 *
 * Customer-facing essentials UI shows the cycle's admin-defined `essentials_label`
 * (e.g., "Morning", "Noon", "Evening"). Food UI uses the real `cycle_name`
 * (Breakfast / Lunch / Snacks / Dinner).
 *
 * If `essentials_label` is empty/null (e.g. data not yet populated), we fall
 * back to the real `cycle_name` so the UI still renders something.
 */

import type { DeliveryCycle } from '../types';

export function essentialsCycleLabel(cycle: Pick<DeliveryCycle, 'cycle_name' | 'essentials_label'>): string {
  const label = cycle.essentials_label?.trim();
  return label && label.length > 0 ? label : cycle.cycle_name;
}
