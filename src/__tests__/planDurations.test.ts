/**
 * 1stOne F1 — the plan builder's length options.
 *
 * WHAT THIS GUARDS. The list used to be the constant `[45, 30, 15]`, correct
 * only while the discount slabs happened to be 10–19 / 20–34 / 35–45. Editing
 * the schedule in Manage → Subscriptions would have left the screen offering
 * lengths that no longer sat one per band — silently, because nothing checks a
 * number against a schedule at runtime.
 *
 * The first case below is therefore the important one: against the SEEDED
 * schedule the derivation must still produce exactly the three lengths the app
 * shipped with. Everything after it is about not breaking when an admin edits.
 */

import {
  roundedWithin,
  durationOptionsFromSlabs,
  type DurationSlab,
} from '@/utils/planDurations';

const MIN = 10;
const MAX = 45;

const slab = (min_days: number, max_days: number, is_active = true): DurationSlab =>
  ({ min_days, max_days, is_active });

/** Mirrors planDiscountSlabs.test.ts and the SQL harness. */
const SEEDED = [slab(10, 19), slab(20, 34), slab(35, 45)];

describe('roundedWithin', () => {
  it('takes the largest multiple of five inside the band', () => {
    expect(roundedWithin(35, 45)).toBe(45);
    expect(roundedWithin(20, 34)).toBe(30);
    expect(roundedWithin(10, 19)).toBe(15);
  });

  it('falls back to the top when no multiple of five fits', () => {
    // 21–24 contains no multiple of 5, so the band's own top is the answer.
    expect(roundedWithin(21, 24)).toBe(24);
  });

  it('handles a single-day band', () => {
    expect(roundedWithin(30, 30)).toBe(30);
    expect(roundedWithin(31, 31)).toBe(31);
  });
});

describe('durationOptionsFromSlabs', () => {
  it('reproduces the three lengths the app shipped with', () => {
    expect(durationOptionsFromSlabs(SEEDED, MIN, MAX)).toEqual([45, 30, 15]);
  });

  it('is longest first, so every step down costs something', () => {
    const out = durationOptionsFromSlabs(SEEDED, MIN, MAX);
    expect([...out].sort((a, b) => b - a)).toEqual(out);
  });

  it('follows the admin when a band is edited', () => {
    const edited = [slab(10, 19), slab(20, 29), slab(30, 45)];
    expect(durationOptionsFromSlabs(edited, MIN, MAX)).toEqual([45, 25, 15]);
  });

  it('ignores an inactive band', () => {
    const off = [slab(10, 19), slab(20, 34, false), slab(35, 45)];
    expect(durationOptionsFromSlabs(off, MIN, MAX)).toEqual([45, 15]);
  });

  it('clamps a band that overruns what the server accepts', () => {
    // create_custom_plan caps at 45 days; an admin widening past it must not
    // put an un-buyable length on the screen.
    expect(durationOptionsFromSlabs([slab(30, 90)], MIN, MAX)).toEqual([45]);
  });

  it('drops a band that lies entirely below the legal minimum', () => {
    // A 1–8 day band cannot yield a buyable length at all, so it contributes
    // nothing and the fallback stands. That is the honest answer rather than
    // inventing a 10: the plan is still purchasable at 10–45 days, the band
    // simply grants no discount at any of them.
    expect(durationOptionsFromSlabs([slab(1, 8)], MIN, MAX)).toEqual([45, 30, 15]);
  });

  it('collapses two bands that round to the same length', () => {
    // 30–34 and 35–39 both round to 30 and 35 respectively — but 31–34 and
    // 32–34 would both yield 34. A repeated option is a decoy, not a choice.
    expect(durationOptionsFromSlabs([slab(31, 34), slab(32, 34)], MIN, MAX)).toEqual([34]);
  });

  it('falls back when no schedule is configured', () => {
    expect(durationOptionsFromSlabs([], MIN, MAX)).toEqual([45, 30, 15]);
    expect(durationOptionsFromSlabs([slab(10, 19, false)], MIN, MAX)).toEqual([45, 30, 15]);
  });
});
