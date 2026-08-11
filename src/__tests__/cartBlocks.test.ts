/**
 * 1stOne F1 — the cart as the bags it will become.
 *
 * These exist because the sort was wrong on a real screen and nothing caught
 * it: cycles were ordered by NAME, so Dinner (7:30 PM) sat above Lunch
 * (12:30 PM). It was the third time this codebase ordered a time by something
 * other than the time, so it is pinned rather than commented.
 */

import {
  groupIntoBlocks,
  extrasByCycle,
  itemsToday,
  itemsLater,
  type CycleTiming,
  type Scenario,
} from '../utils/cartBlocks';
import type { CartItem } from '../types';

const CYCLES: CycleTiming[] = [
  { id: 1, cycle_name: 'Breakfast', delivery_start: '07:30:00' },
  { id: 2, cycle_name: 'Lunch', delivery_start: '12:30:00' },
  { id: 3, cycle_name: 'Snacks', delivery_start: '16:30:00' },
  { id: 4, cycle_name: 'Dinner', delivery_start: '19:30:00' },
];

const item = (o: Partial<CartItem> & { item_id: number; cycle_id: number }): CartItem => ({
  item_type: 'food',
  name: `Item ${o.item_id}`,
  display_price: 50,
  quantity: 1,
  ...o,
});

/** Everything today unless a test says otherwise. */
const allToday = (): Scenario => 'A';

describe('groupIntoBlocks', () => {
  it('orders same-day cycles by TIME, not by name', () => {
    // THE BUG: Dinner sorted above Lunch because "Dinner" < "Lunch".
    const blocks = groupIntoBlocks(
      [item({ item_id: 1, cycle_id: 4 }), item({ item_id: 2, cycle_id: 2 })],
      allToday,
      CYCLES,
    );
    expect(blocks.map((b) => b.cycleName)).toEqual(['Lunch', 'Dinner']);
  });

  it('puts food and essentials of one cycle in ONE bag', () => {
    const blocks = groupIntoBlocks(
      [
        item({ item_id: 1, cycle_id: 2, item_type: 'food' }),
        item({ item_id: 2, cycle_id: 2, item_type: 'essential' }),
      ],
      allToday,
      CYCLES,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].items).toHaveLength(2);
  });

  it('sorts by DAY before time of day', () => {
    // Tomorrow's breakfast (07:30) must not outrank tonight's dinner (19:30).
    const scenarioOf = (i: CartItem): Scenario => (i.cycle_id === 1 ? 'B' : 'A');
    const blocks = groupIntoBlocks(
      [item({ item_id: 1, cycle_id: 1 }), item({ item_id: 2, cycle_id: 4 })],
      scenarioOf,
      CYCLES,
    );
    expect(blocks.map((b) => b.cycleName)).toEqual(['Dinner', 'Breakfast']);
  });

  it('sorts an unknown cycle LAST in its day, not first', () => {
    const blocks = groupIntoBlocks(
      [item({ item_id: 1, cycle_id: 99 }), item({ item_id: 2, cycle_id: 4 })],
      allToday,
      CYCLES,
    );
    expect(blocks.map((b) => b.cycleId)).toEqual([4, 99]);
  });

  it('names an unknown cycle rather than rendering blank', () => {
    const blocks = groupIntoBlocks([item({ item_id: 1, cycle_id: 99 })], allToday, CYCLES);
    expect(blocks[0].cycleName).toBe('Items');
  });

  it('is empty for an empty cart', () => {
    expect(groupIntoBlocks([], allToday, CYCLES)).toEqual([]);
  });
});

describe('itemsToday / itemsLater', () => {
  it('counts across bags, for the mixed-dispatch warning', () => {
    const scenarioOf = (i: CartItem): Scenario => (i.cycle_id === 1 ? 'B' : 'A');
    const blocks = groupIntoBlocks(
      [
        item({ item_id: 1, cycle_id: 2 }),
        item({ item_id: 2, cycle_id: 2 }),
        item({ item_id: 3, cycle_id: 1 }),
      ],
      scenarioOf,
      CYCLES,
    );
    expect(itemsToday(blocks)).toBe(2);
    expect(itemsLater(blocks)).toBe(1);
  });
});

describe('extrasByCycle', () => {
  const MENU = [
    { id: 10, name: 'Curd Rice', price: 50, cycle_id: 2 },
    { id: 11, name: 'Chapati', price: 30, cycle_id: 2 },
    { id: 12, name: 'Idli', price: 40, cycle_id: 1 },
    { id: 13, name: 'Sambar block', price: 0, cycle_id: null },
  ];
  const ESSENTIALS = [
    { id: 20, name: 'Milk', price: 54, cycle_id: 2, unit: '500ml' },
  ];

  it('offers that cycle both catalogues', () => {
    const map = extrasByCycle(MENU, ESSENTIALS, [], true);
    expect(map.get(2)!.map((c) => c.name).sort()).toEqual(['Chapati', 'Curd Rice', 'Milk']);
  });

  it('never offers what is already in the cart', () => {
    const inCart = [item({ item_id: 10, cycle_id: 2 })];
    const map = extrasByCycle(MENU, ESSENTIALS, inCart, true);
    expect(map.get(2)!.map((c) => c.name)).not.toContain('Curd Rice');
  });

  it('tells the two catalogues apart by TYPE, not by id', () => {
    // menu_items and essentials_catalog have independent id sequences, so
    // food 20 and essential 20 are different products. Excluding on id alone
    // would hide an essential because a food item shared its number.
    const inCart = [item({ item_id: 20, cycle_id: 2, item_type: 'food' })];
    const map = extrasByCycle(MENU, ESSENTIALS, inCart, true);
    expect(map.get(2)!.map((c) => c.name)).toContain('Milk');
  });

  it('drops an item with no cycle — a block cannot join a delivery', () => {
    const map = extrasByCycle(MENU, ESSENTIALS, [], true);
    const everything = [...map.values()].flat().map((c) => c.name);
    expect(everything).not.toContain('Sambar block');
  });

  it('leaves essentials out when the module is off', () => {
    const map = extrasByCycle(MENU, ESSENTIALS, [], false);
    expect(map.get(2)!.map((c) => c.name)).toEqual(['Curd Rice', 'Chapati']);
  });

  it('keeps the catalogue order it was given — the admin sort_order', () => {
    const map = extrasByCycle(MENU, [], [], true);
    expect(map.get(2)!.map((c) => c.name)).toEqual(['Curd Rice', 'Chapati']);
  });

  it('coerces a string price, as Postgres numeric arrives', () => {
    const map = extrasByCycle([{ id: 1, name: 'X', price: '75.00', cycle_id: 2 }], [], [], true);
    expect(map.get(2)![0].price).toBe(75);
  });
});
