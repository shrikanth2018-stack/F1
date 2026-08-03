/**
 * 1stOne F1 — the recipe grammar
 *
 * This string is what the kitchen board parses to tell staff what to cook, so
 * the property that matters most is that an edit ROUND-TRIPS. The old
 * composer could not manage it: `parseInt(qty, 10)` turned "150 ml" into
 * "150", and since get_kitchen_aggregate groups prep by (name, unit), that
 * silently split one ingredient into two prep lines — one of which would be
 * under-cooked.
 */

import {
  parseRecipe, buildRecipe, summariseRecipe, isMenuUnit, unitLabel, MENU_UNITS,
} from '@/utils/menuRecipe';

describe('parseRecipe', () => {
  it('reads a real recipe, units and all', () => {
    expect(parseRecipe('Idli:4 no;Sambar:150 ml;Chutney:100 g')).toEqual([
      { name: 'Idli', qty: '4', unit: 'no' },
      { name: 'Sambar', qty: '150', unit: 'ml' },
      { name: 'Chutney', qty: '100', unit: 'g' },
    ]);
  });

  it('reads the older unspaced form', () => {
    // What the CSV import wrote before the units pass. The kitchen's own regex
    // tolerates the missing space, so this must too.
    expect(parseRecipe('Sambar:150ml')).toEqual([{ name: 'Sambar', qty: '150', unit: 'ml' }]);
  });

  it('keeps a component whose unit it does not recognise', () => {
    // Dropping it would silently remove an ingredient from a dish, which is
    // worse than showing it with a default and letting someone fix it.
    const r = parseRecipe('Mystery:2 furlongs');
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Mystery');
    expect(r[0].unit).toBe('no');
  });

  it('handles an empty or absent recipe', () => {
    expect(parseRecipe('')).toEqual([]);
    expect(parseRecipe(null)).toEqual([]);
    expect(parseRecipe(undefined)).toEqual([]);
  });
});

describe('buildRecipe', () => {
  it('round-trips — the regression the old composer had', () => {
    const original = 'Idli:2 no;Vada:1 no;Sambar:150 ml;Chutney:100 g';
    expect(buildRecipe(parseRecipe(original))).toBe(original);
  });

  it('always writes a unit', () => {
    // "4" and "4 no" are DIFFERENT units to the kitchen aggregate. A quantity
    // without one is how a single ingredient becomes two prep lines.
    expect(buildRecipe([{ name: 'Papad', qty: '1', unit: 'no' }])).toBe('Papad:1 no');
  });

  it('drops a part with no usable quantity rather than writing "name:"', () => {
    // The aggregate reads a bare "name:" as a quantity of 1, so writing it
    // would quietly over-order.
    expect(buildRecipe([
      { name: 'Rice', qty: '200', unit: 'g' },
      { name: 'Ghost', qty: '', unit: 'g' },
      { name: 'Zero', qty: '0', unit: 'g' },
    ])).toBe('Rice:200 g');
  });

  it('falls back to a real unit if handed a bad one', () => {
    expect(buildRecipe([{ name: 'X', qty: '2', unit: 'furlong' as never }])).toBe('X:2 no');
  });
});

describe('units', () => {
  it('is the closed set the picker offers', () => {
    expect(MENU_UNITS.map((u) => u.key)).toEqual(['no', 'g', 'ml', 'cup', 'plate', 'bowl']);
  });

  it('accepts only those', () => {
    expect(isMenuUnit('ml')).toBe(true);
    expect(isMenuUnit('litre')).toBe(false);
  });

  it('shows a readable label', () => {
    expect(unitLabel('no')).toBe('Numbers');
    expect(unitLabel('g')).toBe('Grams');
  });
});

describe('summariseRecipe', () => {
  it('names the parts, without quantities', () => {
    // The list row is for finding the right menu, not for reading a recipe.
    expect(summariseRecipe('Idli:2 no;Sambar:150 ml')).toBe('Idli · Sambar');
  });
});
