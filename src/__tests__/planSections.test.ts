/**
 * buildPlanSections — cycle grouping for the Subscribe tab.
 *
 * The interesting case is the one buildSections cannot express: a plan whose
 * cycle is null, or points at a cycle that is no longer active. Both are
 * reachable today (the column is nullable, and cycles get deactivated), and
 * both would drop the plan off the storefront silently while it stayed
 * buyable everywhere else.
 */

import { buildPlanSections } from '../screens/customer/components/homeShared';
import type { DeliveryCycle } from '../types';

const cycle = (id: number, name: string, start: string, cutoff: string) =>
  ({
    id,
    cycle_name: name,
    delivery_start: start,
    cutoff_time: cutoff,
    is_active: true,
  }) as unknown as DeliveryCycle;

// Deliberately NOT in clock order — buildPlanSections must take the order it
// is given (already sorted by cutoff upstream) and not re-sort by name.
const CYCLES = [
  cycle(2, 'Lunch', '12:30:00', '09:00:00'),
  cycle(1, 'Breakfast', '07:30:00', '22:00:00'),
];

const plan = (id: number, cycleId: number | null) => ({ id, cycle_id: cycleId });

describe('buildPlanSections', () => {
  it('groups plans under their cycle, in the order the cycles are given', () => {
    const sections = buildPlanSections(
      [plan(10, 1), plan(11, 2), plan(12, 1)],
      CYCLES
    );

    expect(sections.map((s) => s.title)).toEqual(['Lunch', 'Breakfast']);
    expect(sections[0].data.map((p) => p.id)).toEqual([11]);
    expect(sections[1].data.map((p) => p.id)).toEqual([10, 12]);
  });

  it('carries each cycle dispatch time through for the header', () => {
    const [lunch] = buildPlanSections([plan(10, 2)], CYCLES);
    expect(lunch.deliveryBy).toBe('12:30 PM');
    expect(lunch.cycleId).toBe(2);
  });

  it('omits a cycle that has no plans', () => {
    const sections = buildPlanSections([plan(10, 1)], CYCLES);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Breakfast');
  });

  it('keeps a plan with no cycle instead of dropping it', () => {
    const sections = buildPlanSections([plan(10, 1), plan(99, null)], CYCLES);

    expect(sections.map((s) => s.title)).toEqual(['Breakfast', 'Other plans']);
    expect(sections[1].data.map((p) => p.id)).toEqual([99]);
  });

  it('keeps a plan whose cycle is gone — deactivated, not deleted', () => {
    const sections = buildPlanSections([plan(77, 4)], CYCLES);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Other plans');
    expect(sections[0].data.map((p) => p.id)).toEqual([77]);
  });

  it('gives the catch-all no dispatch time, so the header hides the link', () => {
    const [rest] = buildPlanSections([plan(99, null)], CYCLES);
    // CycleGroup renders the "Dispatch by … ›" line only when this is set.
    expect(rest.deliveryBy).toBe('');
    expect(rest.cycleId).toBe(-1);
  });

  it('puts the catch-all last, after every real cycle', () => {
    const sections = buildPlanSections(
      [plan(99, null), plan(10, 1), plan(11, 2)],
      CYCLES
    );
    expect(sections[sections.length - 1].title).toBe('Other plans');
  });

  it('adds no catch-all when every plan has a live cycle', () => {
    const sections = buildPlanSections([plan(10, 1), plan(11, 2)], CYCLES);
    expect(sections.map((s) => s.title)).not.toContain('Other plans');
  });

  it('returns nothing for no plans', () => {
    expect(buildPlanSections([], CYCLES)).toEqual([]);
  });
});
