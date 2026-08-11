/**
 * 1stOne F1 — the length-based discount schedule.
 *
 * THIS RULE EXISTS TWICE: here, so the builder can show the price move as the
 * customer drags the length, and in SQL (plan_discount_percent) which is what
 * actually prices the plan. Two implementations of one rule is a standing
 * risk, so these cases mirror the SQL harness exactly — same inputs, same
 * expected answers. If one is changed, this file should fail.
 *
 * The seeded schedule: 10-19 → 5%, 20-34 → 8%, 35-45 → 12%.
 */

import { discountForDays, type DiscountSlab } from '../hooks/useCustomPlanConfig';

const slab = (min: number, max: number, percent: number, is_active = true): DiscountSlab => ({
  id: min, min_days: min, max_days: max, percent, is_active,
});

const SEEDED = [slab(10, 19, 5), slab(20, 34, 8), slab(35, 45, 12)];

describe('discountForDays', () => {
  it('matches the seeded schedule at every band', () => {
    expect(discountForDays(15, SEEDED)).toBe(5);
    expect(discountForDays(30, SEEDED)).toBe(8);
    expect(discountForDays(45, SEEDED)).toBe(12);
  });

  it('includes both ends of a band', () => {
    expect(discountForDays(10, SEEDED)).toBe(5);
    expect(discountForDays(19, SEEDED)).toBe(5);
    expect(discountForDays(20, SEEDED)).toBe(8);
    expect(discountForDays(34, SEEDED)).toBe(8);
  });

  it('gives 0 outside the schedule rather than failing', () => {
    // A gap must mean "no discount", never a builder that refuses to price.
    expect(discountForDays(7, SEEDED)).toBe(0);
    expect(discountForDays(60, SEEDED)).toBe(0);
  });

  it('gives 0 for a hole between bands', () => {
    const holed = [slab(10, 19, 5), slab(30, 45, 12)];
    expect(discountForDays(25, holed)).toBe(0);
  });

  it('takes the HIGHEST when bands overlap', () => {
    // An admin can save overlapping ranges — the DB CHECK only guards each
    // row on its own — and the customer should not lose to a config mistake.
    const overlapping = [...SEEDED, slab(28, 32, 20)];
    expect(discountForDays(30, overlapping)).toBe(20);
  });

  it('ignores an inactive band', () => {
    const off = [slab(10, 19, 5), slab(20, 34, 8, false)];
    expect(discountForDays(30, off)).toBe(0);
  });

  it('is 0 when no schedule is configured at all', () => {
    expect(discountForDays(30, [])).toBe(0);
  });

  it('coerces a numeric arriving as a string', () => {
    // Postgres NUMERIC comes back as a string through PostgREST.
    const stringy = [{ ...slab(20, 34, 0), percent: '8.00' as unknown as number }];
    expect(discountForDays(30, stringy)).toBe(8);
  });
});
