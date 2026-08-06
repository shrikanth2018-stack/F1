/**
 * 1stOne F1 — Plan contents + plan pricing.
 *
 * The money assertion here is the reason this file exists: a food plan's
 * price is the daily total TIMES the number of days. The builder used to set
 * it to the daily total alone, so plan #25 was ₹115 for thirty days of a ₹115
 * breakfast. That case is reproduced by name below.
 *
 * Every test was mutation-checked before being trusted (CLAUDE.md §6): the
 * behaviour was broken, the test confirmed red, then reverted.
 */

import {
  dailyTotal,
  planPriceFor,
  fromRecipe,
  formatPlanLine,
  portionOf,
  type BlockLike,
  type PlanLine,
} from '../utils/planItems';

// The real blocks, at their real prices and portions.
const IDLI: BlockLike   = { id: 109, name: 'Idli',   price: 10, unit: 'nos', base_quantity: 1 };
const SAMBAR: BlockLike = { id: 110, name: 'Sambar', price: 10, unit: 'ml',  base_quantity: 150 };
const CHUTNEY: BlockLike= { id: 111, name: 'Chutney',price: 5,  unit: 'gms', base_quantity: 100 };
const VADA: BlockLike   = { id: 112, name: 'Vada',   price: 15, unit: 'nos', base_quantity: 1 };
const SAGU: BlockLike   = { id: 118, name: 'Sagu',   price: 15, unit: 'ml',  base_quantity: 150 };
const BLOCKS = [IDLI, SAMBAR, CHUTNEY, VADA, SAGU];

const line = (b: BlockLike, quantity: number): PlanLine => ({
  item_id: b.id,
  item_name: b.name,
  quantity,
  unit: b.unit,
  base_quantity: b.base_quantity,
});

describe('portionOf', () => {
  it('reads the block portion', () => {
    expect(portionOf(SAMBAR)).toBe(150);
  });

  it('falls back to 1 rather than 0 — a missing portion must not erase a line', () => {
    expect(portionOf(undefined)).toBe(1);
    expect(portionOf({ base_quantity: null })).toBe(1);
    expect(portionOf({ base_quantity: 0 })).toBe(1);
  });
});

describe('dailyTotal', () => {
  it("prices a line at the block's price per PORTION, not per unit of measure", () => {
    // Sambar is ₹10 for 150 ml. One portion is ₹10 — never ₹10 × 150.
    expect(dailyTotal([line(SAMBAR, 1)], BLOCKS)).toBe(10);
    expect(dailyTotal([line(SAMBAR, 2)], BLOCKS)).toBe(20);
  });

  it('sums a whole day', () => {
    // 4 idli + 1 sambar + 1 chutney = 40 + 10 + 5
    const items = [line(IDLI, 4), line(SAMBAR, 1), line(CHUTNEY, 1)];
    expect(dailyTotal(items, BLOCKS)).toBe(55);
  });

  it('skips a line whose block has gone missing instead of throwing', () => {
    const orphan: PlanLine = { item_id: 999, item_name: 'Deleted', quantity: 3 };
    expect(dailyTotal([line(IDLI, 2), orphan], BLOCKS)).toBe(20);
  });

  it('is zero for an empty plan', () => {
    expect(dailyTotal([], BLOCKS)).toBe(0);
  });
});

describe('planPriceFor', () => {
  /**
   * The bug this whole change was built around. Idli Full Plate ₹50 + Vada
   * Full Plate ₹65 came to ₹115, and ₹115 is what a thirty-day plan charged.
   */
  it('multiplies by the days — regression: plan #25 was ₹115 for 30 days', () => {
    expect(planPriceFor(115, 30)).toBe(3450);
    expect(planPriceFor(115, 30)).not.toBe(115);
  });

  it('handles a real block-built breakfast', () => {
    const daily = dailyTotal([line(IDLI, 4), line(SAMBAR, 1)], BLOCKS); // 50
    expect(planPriceFor(daily, 30)).toBe(1500);
  });

  it('rounds to paise, not to rupees', () => {
    expect(planPriceFor(12.345, 3)).toBe(37.04);
  });

  it('returns 0 for a duration that is missing, zero or negative', () => {
    expect(planPriceFor(50, 0)).toBe(0);
    expect(planPriceFor(50, -1)).toBe(0);
    expect(planPriceFor(50, NaN)).toBe(0);
  });
});

describe('fromRecipe', () => {
  it('converts an exact recipe into whole portion counts', () => {
    // Idli Full Plate: Idli:4 nos;Sambar:150 ml
    const { lines, adjusted, unmatched } = fromRecipe('Idli:4 nos;Sambar:150 ml', BLOCKS);
    expect(adjusted).toEqual([]);
    expect(unmatched).toEqual([]);
    expect(lines).toEqual([
      { item_id: 109, item_name: 'Idli',   quantity: 4, unit: 'nos', base_quantity: 1 },
      { item_id: 110, item_name: 'Sambar', quantity: 1, unit: 'ml',  base_quantity: 150 },
    ]);
  });

  it('rounds a part-portion line AND reports it — Lunch Box asks 200 ml of a 150 ml Sambar', () => {
    const { lines, adjusted } = fromRecipe('Sambar:200 ml;Sagu:200 ml', BLOCKS);
    expect(lines.map((l) => l.quantity)).toEqual([1, 1]);
    expect(adjusted).toEqual([
      { name: 'Sambar', from: '200 ml', to: '150 ml' },
      { name: 'Sagu',   from: '200 ml', to: '150 ml' },
    ]);
  });

  it('rounds a part-portion UP — Masala Dosa takes 100 ml of a 150 ml Sambar', () => {
    // 100 / 150 = 0.667 → 1 portion.
    const { lines, adjusted } = fromRecipe('Sambar:100 ml', BLOCKS);
    expect(lines[0].quantity).toBe(1);
    expect(adjusted).toEqual([{ name: 'Sambar', from: '100 ml', to: '150 ml' }]);
  });

  it('never rounds a line down to NOTHING — 30 gms of a 100 gms Chutney', () => {
    // 30 / 100 = 0.3, and Math.round(0.3) is 0. Without the floor of one the
    // ingredient would vanish from the plan silently — a subscriber served a
    // dish missing a component nobody could see was gone. This shape is real:
    // the menu import template itself carries "Chutney:30g".
    const { lines, adjusted } = fromRecipe('Chutney:30 gms', BLOCKS);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(1);
    expect(adjusted).toEqual([{ name: 'Chutney', from: '30 gms', to: '100 gms' }]);
  });

  it('matches a block name case-insensitively', () => {
    const { lines, unmatched } = fromRecipe('sambar:150 ml', BLOCKS);
    expect(unmatched).toEqual([]);
    expect(lines[0].item_id).toBe(110);
  });

  it('reports a part with no block instead of silently dropping it', () => {
    const { lines, unmatched } = fromRecipe('Idli:2 nos;Ghee:10 ml', BLOCKS);
    expect(lines).toHaveLength(1);
    expect(unmatched).toEqual(['Ghee']);
  });

  it("takes the unit from the BLOCK, not from the recipe text", () => {
    // A recipe cached before the block's unit changed must not write the old
    // one back — the same rule the menu editor enforces at save time.
    const { lines } = fromRecipe('Sambar:150 gms', BLOCKS);
    expect(lines[0].unit).toBe('ml');
  });

  it('is empty for a menu with no recipe', () => {
    expect(fromRecipe(null, BLOCKS).lines).toEqual([]);
    expect(fromRecipe('', BLOCKS).lines).toEqual([]);
  });
});

describe('formatPlanLine', () => {
  it('reads as an amount when the portion is known', () => {
    expect(formatPlanLine(line(SAMBAR, 1))).toBe('Sambar 150 ml');
  });

  it('shows the multiplier above one portion', () => {
    expect(formatPlanLine(line(IDLI, 4))).toBe('Idli 4 × 1 nos');
  });

  it('falls back to a bare count when no portion was stored', () => {
    // Plans written before the snapshot existed, and every essentials plan.
    expect(formatPlanLine({ item_id: 1, item_name: 'Full Cream Milk 1L', quantity: 2 }))
      .toBe('Full Cream Milk 1L ×2');
  });

  it('falls back when the unit is present but the portion is not', () => {
    expect(formatPlanLine({ item_id: 1, item_name: 'Milk', quantity: 1, unit: 'ml' }))
      .toBe('Milk ×1');
  });
});
