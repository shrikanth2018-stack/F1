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

/**
 * The same grouping for subscription plans, plus a catch-all group.
 *
 * `buildSections` walks the CYCLES and keeps the ones that have items, so
 * anything whose cycle is missing from the list is dropped without a trace.
 * For food and essentials that is correct — an item belongs to a cycle by
 * construction. A plan does not: `subscription_plans.cycle_id` is nullable,
 * and a cycle can be deactivated while plans still point at it. Either way
 * the plan would simply vanish from the storefront, still buyable everywhere
 * else, with nothing on screen to say so. This app has lost rows to a silent
 * filter before; a visible leftover group is the cheaper mistake.
 *
 * Deliberately no `deliveryBy` for the leftovers — there is no cycle to read
 * a dispatch time from, and inventing one would be worse than omitting it.
 */
export function buildPlanSections<T extends { cycle_id: number | null }>(
  plans: T[],
  cycles: DeliveryCycle[],
  restTitle = 'Other plans'
): Array<SectionMeta & { data: T[] }> {
  const known = new Set(cycles.map((c) => c.id));
  const placed = plans.filter((p) => p.cycle_id != null && known.has(p.cycle_id));
  const rest = plans.filter((p) => p.cycle_id == null || !known.has(p.cycle_id));

  // The filter above proves cycle_id is a number on every row in `placed`,
  // which the type system cannot see through a predicate.
  const sections = buildSections(
    placed as unknown as Array<T & { cycle_id: number }>,
    cycles
  ) as Array<SectionMeta & { data: T[] }>;
  if (rest.length > 0) {
    sections.push({
      title: restTitle,
      deliveryBy: '',
      cutoffTime: '',
      cycleId: -1,
      data: rest,
    });
  }
  return sections;
}
