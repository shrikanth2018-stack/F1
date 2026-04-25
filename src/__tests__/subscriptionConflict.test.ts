/**
 * Tests for the core-items subscription conflict helper.
 *
 * Rules per blueprint (Smart Conflict Prevention):
 *   - Two different plans on the same cycle are fine IF their core items differ.
 *   - Two plans sharing any core item_id AND the same plan_type → conflict.
 *   - Food plans never conflict with essentials plans (different plan_type).
 *   - If the new plan has no items, no conflict is reported.
 */

import {
  planItemIds,
  findCoreItemConflict,
  startAfterDate,
  type ActiveSubForConflict,
} from '@/utils/subscriptionConflict';

// ── Test helpers ─────────────────────────────────────────
function makeSub(
  overrides: Partial<ActiveSubForConflict> & { itemIds: number[] }
): ActiveSubForConflict {
  return {
    id: overrides.id ?? 1,
    plan_id: overrides.plan_id ?? 100,
    start_date: overrides.start_date ?? '2026-04-01',
    duration_days: overrides.duration_days ?? 30,
    plan_name: overrides.plan_name ?? 'Existing Plan',
    plan_type: overrides.plan_type ?? 'food',
    cycle_id: overrides.cycle_id ?? 1,
    plan_items: overrides.itemIds.map((id) => ({
      item_id: id,
      item_name: `Item ${id}`,
      quantity: 1,
    })),
  };
}

// ── planItemIds ──────────────────────────────────────────
describe('planItemIds', () => {
  it('returns an empty set for null / undefined / empty input', () => {
    expect(planItemIds(null).size).toBe(0);
    expect(planItemIds(undefined).size).toBe(0);
    expect(planItemIds([]).size).toBe(0);
  });

  it('returns the set of item_ids from plan_items', () => {
    const ids = planItemIds([
      { item_id: 1, item_name: 'A', quantity: 1 },
      { item_id: 2, item_name: 'B', quantity: 2 },
    ]);
    expect(ids.has(1)).toBe(true);
    expect(ids.has(2)).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('skips entries with non-numeric item_id', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const malformed: any[] = [
      { item_name: 'no id', quantity: 1 },
      { item_id: 'abc', item_name: 'bad id', quantity: 1 },
      { item_id: 7, item_name: 'good', quantity: 1 },
    ];
    const ids = planItemIds(malformed);
    expect(ids.size).toBe(1);
    expect(ids.has(7)).toBe(true);
  });
});

// ── findCoreItemConflict ─────────────────────────────────
describe('findCoreItemConflict', () => {
  it('returns null when no active subs exist', () => {
    expect(findCoreItemConflict('food', new Set([1]), [])).toBeNull();
  });

  it('returns null when the new plan has no items (guard against empty plan_items)', () => {
    const sub = makeSub({ itemIds: [1, 2] });
    expect(findCoreItemConflict('food', new Set(), [sub])).toBeNull();
  });

  it('does not conflict across different plan_types (food vs essentials)', () => {
    const essentialsSub = makeSub({ itemIds: [1], plan_type: 'essentials' });
    expect(findCoreItemConflict('food', new Set([1]), [essentialsSub])).toBeNull();
  });

  it('detects overlap when same plan_type shares any item_id', () => {
    const sub = makeSub({ id: 42, itemIds: [1, 2, 3], plan_name: 'Bread 30' });
    const result = findCoreItemConflict('food', new Set([2, 99]), [sub]);
    expect(result?.id).toBe(42);
    expect(result?.plan_name).toBe('Bread 30');
  });

  it('allows plans on same cycle with disjoint item sets (blueprint rule)', () => {
    const bread = makeSub({ id: 1, itemIds: [1], plan_name: 'Bread Plan' });
    const eggs  = makeSub({ id: 2, itemIds: [2], plan_name: 'Egg Plan'  });
    // New plan delivers item 2 only → collides with eggs only, not bread.
    const result = findCoreItemConflict('food', new Set([2]), [bread, eggs]);
    expect(result?.id).toBe(2);
  });

  it('returns the first matching sub when multiple overlap', () => {
    const subA = makeSub({ id: 10, itemIds: [5], plan_name: 'A' });
    const subB = makeSub({ id: 11, itemIds: [5], plan_name: 'B' });
    const result = findCoreItemConflict('food', new Set([5]), [subA, subB]);
    expect(result?.id).toBe(10);
  });

  // Regression guard for the bug we just hit in production:
  // client-side check silently passed because existing sub's plan_items were missing.
  it('regression: sub with empty plan_items does not match anything', () => {
    const subWithNoItems = makeSub({ id: 99, itemIds: [] });
    expect(findCoreItemConflict('food', new Set([1, 2, 3]), [subWithNoItems])).toBeNull();
  });
});

// ── startAfterDate ───────────────────────────────────────
describe('startAfterDate', () => {
  it('returns the day after the last delivery of the existing sub', () => {
    const sub = makeSub({ start_date: '2026-04-01', duration_days: 30, itemIds: [] });
    expect(startAfterDate(sub)).toBe('2026-05-01');
  });

  it('handles short durations', () => {
    const sub = makeSub({ start_date: '2026-04-10', duration_days: 10, itemIds: [] });
    expect(startAfterDate(sub)).toBe('2026-04-20');
  });

  it('crosses month boundaries correctly', () => {
    const sub = makeSub({ start_date: '2026-04-20', duration_days: 15, itemIds: [] });
    expect(startAfterDate(sub)).toBe('2026-05-05');
  });

  it('handles year boundary', () => {
    const sub = makeSub({ start_date: '2026-12-20', duration_days: 20, itemIds: [] });
    expect(startAfterDate(sub)).toBe('2027-01-09');
  });
});
