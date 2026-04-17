/**
 * Tests for the subscription conflict detection predicate.
 *
 * Rule (from PlanDetailScreen):
 *   A new plan conflicts with an existing active subscription if they share
 *   BOTH the same cycle_id AND the same plan_type.
 *
 *   - Same cycle, different plan_type (food vs essentials) → NOT a conflict
 *   - Different cycle, same plan_type                      → NOT a conflict
 *   - Paused or inactive subscriptions                    → NOT a conflict
 *   - Same cycle + same plan_type + is_active = true       → CONFLICT
 */

interface MockSub {
  is_active: boolean;
  is_paused?: boolean;
  subscription_plans?: {
    cycle_id: number;
    plan_type: string;
  } | null;
}

interface MockPlan {
  cycle_id: number;
  plan_type: string;
}

/** Mirror of the filter predicate in PlanDetailScreen */
function findConflictingSubs(subs: MockSub[], plan: MockPlan): MockSub[] {
  return subs.filter(
    (s) =>
      s.is_active &&
      !s.is_paused &&
      s.subscription_plans?.cycle_id === plan.cycle_id &&
      s.subscription_plans?.plan_type === plan.plan_type
  );
}

const FOOD_PLAN: MockPlan = { cycle_id: 1, plan_type: 'food' };
const ESS_PLAN: MockPlan  = { cycle_id: 1, plan_type: 'essentials' };

describe('subscription conflict detection', () => {
  it('detects a conflict when same cycle_id and same plan_type', () => {
    const subs: MockSub[] = [
      { is_active: true, subscription_plans: { cycle_id: 1, plan_type: 'food' } },
    ];
    expect(findConflictingSubs(subs, FOOD_PLAN)).toHaveLength(1);
  });

  it('no conflict when same cycle but different plan_type', () => {
    const subs: MockSub[] = [
      { is_active: true, subscription_plans: { cycle_id: 1, plan_type: 'food' } },
    ];
    expect(findConflictingSubs(subs, ESS_PLAN)).toHaveLength(0);
  });

  it('no conflict when same plan_type but different cycle_id', () => {
    const subs: MockSub[] = [
      { is_active: true, subscription_plans: { cycle_id: 2, plan_type: 'food' } },
    ];
    expect(findConflictingSubs(subs, FOOD_PLAN)).toHaveLength(0);
  });

  it('no conflict when subscription is inactive', () => {
    const subs: MockSub[] = [
      { is_active: false, subscription_plans: { cycle_id: 1, plan_type: 'food' } },
    ];
    expect(findConflictingSubs(subs, FOOD_PLAN)).toHaveLength(0);
  });

  it('no conflict when subscription is paused', () => {
    const subs: MockSub[] = [
      { is_active: true, is_paused: true, subscription_plans: { cycle_id: 1, plan_type: 'food' } },
    ];
    expect(findConflictingSubs(subs, FOOD_PLAN)).toHaveLength(0);
  });

  it('no conflict when subscription has no plan details', () => {
    const subs: MockSub[] = [
      { is_active: true, subscription_plans: null },
    ];
    expect(findConflictingSubs(subs, FOOD_PLAN)).toHaveLength(0);
  });

  it('returns empty array for empty subscription list', () => {
    expect(findConflictingSubs([], FOOD_PLAN)).toHaveLength(0);
  });

  it('allows food + essentials on the same cycle (not a conflict)', () => {
    const subs: MockSub[] = [
      { is_active: true, subscription_plans: { cycle_id: 1, plan_type: 'food' } },
      { is_active: true, subscription_plans: { cycle_id: 1, plan_type: 'essentials' } },
    ];
    // Food plan conflicts with the food sub but not the essentials sub
    expect(findConflictingSubs(subs, FOOD_PLAN)).toHaveLength(1);
    // Essentials plan conflicts with the essentials sub but not the food sub
    expect(findConflictingSubs(subs, ESS_PLAN)).toHaveLength(1);
  });

  it('allows two active subs on different cycles with same plan_type', () => {
    const plan_cycle2: MockPlan = { cycle_id: 2, plan_type: 'food' };
    const subs: MockSub[] = [
      { is_active: true, subscription_plans: { cycle_id: 1, plan_type: 'food' } },
    ];
    expect(findConflictingSubs(subs, plan_cycle2)).toHaveLength(0);
  });

  it('finds multiple conflicting subs when they exist', () => {
    const subs: MockSub[] = [
      { is_active: true, subscription_plans: { cycle_id: 1, plan_type: 'food' } },
      { is_active: true, subscription_plans: { cycle_id: 1, plan_type: 'food' } }, // duplicate
      { is_active: false, subscription_plans: { cycle_id: 1, plan_type: 'food' } }, // inactive
    ];
    expect(findConflictingSubs(subs, FOOD_PLAN)).toHaveLength(2);
  });
});
