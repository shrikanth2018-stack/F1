/**
 * 1stOne F1 — Home screen shared bits
 *
 * The SectionMeta shape + the cycle grouping/sorting helpers used by the
 * Home screen and its sub-components. Extracted from HomeScreen (audit D22).
 */

import { timeToMinutes, formatTime12h } from '../../../utils/timeEngine';
import { istMinutesNow } from '../../../utils/istDate';
import type { DeliveryCycle } from '../../../types';

export interface SectionMeta {
  title: string;
  deliveryBy: string;
  cutoffTime: string;
  cycleId: number;
}

/** Order cycles so the next still-open cutoff floats to the top. */
export function sortByCutoff(cycles: DeliveryCycle[]): DeliveryCycle[] {
  const nowMin = istMinutesNow();
  return [...cycles].sort((a, b) => {
    const aMin = timeToMinutes(a.cutoff_time);
    const bMin = timeToMinutes(b.cutoff_time);
    const aFuture = aMin > nowMin;
    const bFuture = bMin > nowMin;
    if (aFuture && !bFuture) return -1;
    if (!aFuture && bFuture) return 1;
    return aMin - bMin;
  });
}

/** Group items by cycle_id and attach each cycle's display meta. */
export function buildSections<T extends { cycle_id: number }>(
  items: T[],
  cycles: DeliveryCycle[]
): Array<SectionMeta & { data: T[] }> {
  const grouped = new Map<number, T[]>();
  for (const item of items) {
    const list = grouped.get(item.cycle_id) ?? [];
    list.push(item);
    grouped.set(item.cycle_id, list);
  }
  return cycles
    .filter((c) => grouped.has(c.id))
    .map((cycle) => ({
      title: cycle.cycle_name,
      deliveryBy: formatTime12h(cycle.delivery_start),
      cutoffTime: formatTime12h(cycle.cutoff_time),
      cycleId: cycle.id,
      data: grouped.get(cycle.id) ?? [],
    }));
}
