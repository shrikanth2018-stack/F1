/**
 * 1stOne F1 — "you could be paying less on a plan".
 *
 * The two live plans are the fixtures, because the maths has to be right for
 * the numbers actually on the screen:
 *   Breakfast 30 — Idli Vada (₹65) ×1, 30 days, ₹1,250  → save ₹700
 *   Milk 15      — Nandini Milk (₹54) ×1, 15 days, ₹775 → save ₹35
 */

import {
  savingsForItem,
  bestCartSaving,
  humaniseDuration,
  parsePlanItems,
  type PlanForSavings,
} from '../utils/subscriptionSavings';

const BREAKFAST_30: PlanForSavings = {
  id: 26,
  plan_name: 'Breakfast 30',
  price: '1250.00',
  duration_days: 30,
  plan_type: 'food',
  plan_items: '[{"item_id":160,"item_name":"Idli Vada","quantity":1}]',
  is_active: true,
};

const MILK_15: PlanForSavings = {
  id: 27,
  plan_name: 'Milk 15',
  price: '775.00',
  duration_days: 15,
  plan_type: 'essentials',
  plan_items: '[{"item_id":9,"item_name":"NANDINI SHUBHAM Milk","quantity":1}]',
  is_active: true,
};

const PRICES: Record<number, number> = { 160: 65, 9: 54 };
const priceOf = (id: number) => PRICES[id] ?? null;

describe('savingsForItem', () => {
  it('gets Breakfast 30 right', () => {
    const s = savingsForItem(160, 'food', [BREAKFAST_30], priceOf);
    expect(s).not.toBeNull();
    expect(s!.planName).toBe('Breakfast 30');
    expect(s!.catalogPerDay).toBe(65);
    expect(s!.perDay).toBeCloseTo(41.67, 2);
    expect(s!.totalSaving).toBe(700); // 65×30 − 1250
    expect(s!.percent).toBe(36);
  });

  it('gets Milk 15 right, thin though it is', () => {
    const s = savingsForItem(9, 'essential', [MILK_15], priceOf);
    expect(s!.totalSaving).toBe(35); // 54×15 − 775
    expect(s!.percent).toBe(4);
  });

  it('matches the PLURAL plan_type against a SINGULAR item type', () => {
    // A plan is 'essentials'; an order line is 'essential'. String equality
    // between them silently found nothing, which is the kind of miss that
    // looks like "the feature does not work" rather than a bug.
    expect(savingsForItem(9, 'essential', [MILK_15], priceOf)).not.toBeNull();
  });

  it('does not offer a food plan for an essential, or the reverse', () => {
    expect(savingsForItem(160, 'essential', [BREAKFAST_30], priceOf)).toBeNull();
    expect(savingsForItem(9, 'food', [MILK_15], priceOf)).toBeNull();
  });

  it('says nothing for an item no plan delivers', () => {
    expect(savingsForItem(999, 'food', [BREAKFAST_30, MILK_15], priceOf)).toBeNull();
  });

  it('ignores an inactive plan', () => {
    const off = { ...BREAKFAST_30, is_active: false };
    expect(savingsForItem(160, 'food', [off], priceOf)).toBeNull();
  });

  it('stays silent when the plan is not cheaper', () => {
    // A plan priced at or above the catalogue is not a saving, and claiming
    // one would be a lie the customer can check.
    const overpriced = { ...BREAKFAST_30, price: 1950 }; // exactly 65×30
    expect(savingsForItem(160, 'food', [overpriced], priceOf)).toBeNull();
  });

  it('compares the WHOLE plan, not just the line that matched', () => {
    // Idli ₹65 + milk ₹54 = ₹119/day × 30 = ₹3,570 against ₹2,000 → ₹1,570.
    // Comparing the idli alone would have claimed only ₹1,950 − 2,000 = none.
    const combo: PlanForSavings = {
      id: 99, plan_name: 'Combo 30', price: 2000, duration_days: 30,
      plan_type: 'food',
      plan_items: '[{"item_id":160,"quantity":1},{"item_id":9,"quantity":1}]',
      is_active: true,
    };
    const s = savingsForItem(160, 'food', [combo], priceOf);
    expect(s!.catalogPerDay).toBe(119);
    expect(s!.totalSaving).toBe(1570);
  });

  it('skips a plan it cannot price rather than half-counting it', () => {
    const withUnknown: PlanForSavings = {
      ...BREAKFAST_30,
      plan_items: '[{"item_id":160,"quantity":1},{"item_id":404,"quantity":1}]',
    };
    expect(savingsForItem(160, 'food', [withUnknown], priceOf)).toBeNull();
  });

  it('leads with the biggest saving when two plans cover the item', () => {
    const weaker = { ...BREAKFAST_30, id: 50, plan_name: 'Weaker', price: 1900 };
    const s = savingsForItem(160, 'food', [weaker, BREAKFAST_30], priceOf);
    expect(s!.planName).toBe('Breakfast 30');
  });

  it('honours a threshold when one is passed', () => {
    expect(savingsForItem(9, 'essential', [MILK_15], priceOf, 100)).toBeNull();
    expect(savingsForItem(160, 'food', [BREAKFAST_30], priceOf, 100)).not.toBeNull();
  });
});

describe('parsePlanItems', () => {
  it('reads the TEXT column', () => {
    expect(parsePlanItems('[{"item_id":160,"quantity":2}]')).toEqual([
      { item_id: 160, quantity: 2 },
    ]);
  });

  it('reads an already-parsed array', () => {
    expect(parsePlanItems([{ item_id: 9, quantity: 1 }])).toEqual([
      { item_id: 9, quantity: 1 },
    ]);
  });

  it('defaults a missing quantity to one', () => {
    expect(parsePlanItems('[{"item_id":9}]')).toEqual([{ item_id: 9, quantity: 1 }]);
  });

  it('survives junk without throwing — a bad plan costs a nudge, not the cart', () => {
    expect(parsePlanItems('not json')).toEqual([]);
    expect(parsePlanItems(null)).toEqual([]);
    expect(parsePlanItems('{"not":"an array"}')).toEqual([]);
    expect(parsePlanItems('[{"no_item_id":1}]')).toEqual([]);
  });
});

describe('bestCartSaving', () => {
  const cart = [
    { item_id: 160, item_type: 'food' as const, name: 'Idli Vada' },
    { item_id: 9, item_type: 'essential' as const, name: 'NANDINI SHUBHAM Milk' },
  ];

  it('picks the BIGGEST saving in the cart, not the first', () => {
    // Milk is listed second and saves ₹35; idli saves ₹700. Below the total
    // there is one line, so a customer weighing a plan must see the best case.
    const s = bestCartSaving(cart, [MILK_15, BREAKFAST_30], priceOf);
    expect(s!.itemName).toBe('Idli Vada');
    expect(s!.totalSaving).toBe(700);
  });

  it('names the CART item, so the copy can say what it is about', () => {
    const s = bestCartSaving([cart[1]], [MILK_15], priceOf);
    expect(s!.itemName).toBe('NANDINI SHUBHAM Milk');
  });

  it('is null when nothing in the cart is on a plan', () => {
    const other = [{ item_id: 999, item_type: 'food' as const, name: 'Chapati' }];
    expect(bestCartSaving(other, [BREAKFAST_30, MILK_15], priceOf)).toBeNull();
  });

  it('is null for an empty cart', () => {
    expect(bestCartSaving([], [BREAKFAST_30], priceOf)).toBeNull();
  });
});

describe('humaniseDuration', () => {
  it('says what a person would say', () => {
    expect(humaniseDuration(30)).toBe('a month');
    expect(humaniseDuration(7)).toBe('a week');
    expect(humaniseDuration(15)).toBe('15 days');
  });

  it('never calls a 15-day plan a month', () => {
    // The copy said "over a month" as a fixed string. Right for Breakfast 30,
    // wrong for Milk 15 — and half the plans that exist are Milk 15.
    expect(humaniseDuration(MILK_15.duration_days)).not.toContain('month');
  });

  it('falls back to plain days for anything unusual', () => {
    expect(humaniseDuration(45)).toBe('45 days');
  });
});
