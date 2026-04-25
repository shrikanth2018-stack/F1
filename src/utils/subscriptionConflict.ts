/**
 * 1stOne F1 — Subscription Conflict Detection (Core Items)
 *
 * The blueprint distinguishes "plan overlap" from "item overlap":
 *   - Two different plans on the same cycle are fine (e.g. Bread plan + Egg plan)
 *   - Two plans delivering the SAME core item collide — even across plan names
 *     (e.g. 15-Day Bread vs 30-Day Bread)
 *
 * This utility returns the first active subscription whose core items overlap
 * with the incoming plan. Caller uses that to render the "Start After" dialog.
 */

import type { SubscriptionPlanItem } from '../types';

export interface ActiveSubForConflict {
  id: number;
  start_date: string;
  plan_id: number;
  plan_items: SubscriptionPlanItem[];
  duration_days: number;
  plan_name: string;
  plan_type: 'food' | 'essentials';
  cycle_id: number;
}

/**
 * Returns the set of item_ids present in the given plan_items list.
 */
export function planItemIds(items: SubscriptionPlanItem[] | null | undefined): Set<number> {
  const ids = new Set<number>();
  for (const it of items ?? []) {
    if (typeof it?.item_id === 'number') ids.add(it.item_id);
  }
  return ids;
}

/**
 * Returns the first active subscription whose plan delivers any core item
 * in common with the incoming plan's item list — or null if none overlap.
 *
 * `plan_type` must match: food plans only conflict with food subs, likewise essentials.
 */
export function findCoreItemConflict(
  newPlanType: 'food' | 'essentials',
  newPlanItemIds: Set<number>,
  activeSubs: ActiveSubForConflict[],
): ActiveSubForConflict | null {
  if (newPlanItemIds.size === 0) return null;
  for (const sub of activeSubs) {
    if (sub.plan_type !== newPlanType) continue;
    const existingIds = planItemIds(sub.plan_items);
    for (const id of newPlanItemIds) {
      if (existingIds.has(id)) return sub;
    }
  }
  return null;
}

/**
 * Compute the day AFTER the existing sub's last delivery —
 * i.e. the earliest allowed start for a queued replacement.
 */
export function startAfterDate(sub: ActiveSubForConflict): string {
  const start = new Date(sub.start_date);
  start.setDate(start.getDate() + sub.duration_days);
  return start.toISOString().split('T')[0];
}
