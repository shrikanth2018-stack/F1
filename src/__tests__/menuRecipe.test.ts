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
  parseRecipe, buildRecipe, summariseRecipe, isMenuUnit, toMenuUnit, MENU_UNITS,
  portionCount, countToQty,
} from '@/utils/menuRecipe';

describe('parseRecipe', () => {
  it('reads a real recipe, units and all', () => {
    expect(parseRecipe('Idli:4 nos;Sambar:150 ml;Chutney:100 gms')).toEqual([
      { name: 'Idli', qty: '4', unit: 'nos' },
      { name: 'Sambar', qty: '150', unit: 'ml' },
      { name: 'Chutney', qty: '100', unit: 'gms' },
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
    expect(r[0].unit).toBe('nos');
  });

  it('handles an empty or absent recipe', () => {
    expect(parseRecipe('')).toEqual([]);
    expect(parseRecipe(null)).toEqual([]);
    expect(parseRecipe(undefined)).toEqual([]);
  });
});

describe('buildRecipe', () => {
  it('round-trips — the regression the old composer had', () => {
    const original = 'Idli:2 nos;Vada:1 nos;Sambar:150 ml;Chutney:100 gms';
    expect(buildRecipe(parseRecipe(original))).toBe(original);
  });

  it('always writes a unit', () => {
    // "4" and "4 nos" are DIFFERENT units to the kitchen aggregate. A quantity
    // without one is how a single ingredient becomes two prep lines.
    expect(buildRecipe([{ name: 'Papad', qty: '1', unit: 'nos' }])).toBe('Papad:1 nos');
  });

  it('drops a part with no usable quantity rather than writing "name:"', () => {
    // The aggregate reads a bare "name:" as a quantity of 1, so writing it
    // would quietly over-order.
    expect(buildRecipe([
      { name: 'Rice', qty: '200', unit: 'gms' },
      { name: 'Ghost', qty: '', unit: 'gms' },
      { name: 'Zero', qty: '0', unit: 'gms' },
    ])).toBe('Rice:200 gms');
  });

  it('falls back to a real unit if handed a bad one', () => {
    expect(buildRecipe([{ name: 'X', qty: '2', unit: 'furlong' as never }])).toBe('X:2 nos');
  });
});

describe('units', () => {
  it('is the closed set the picker offers', () => {
    expect([...MENU_UNITS]).toEqual(['nos', 'gms', 'ml', 'cup', 'plate', 'bowl']);
  });

  it('accepts only those', () => {
    expect(isMenuUnit('ml')).toBe(true);
    expect(isMenuUnit('litre')).toBe(false);
  });

  it('reads the tokens an older release stored', () => {
    // menu_unit_wording.sql rewrote the database, but a recipe cached on a
    // phone from before that release still says 'g'. Reading tolerates it;
    // writing only ever produces the new token.
    expect(toMenuUnit('g')).toBe('gms');
    expect(toMenuUnit('no')).toBe('nos');
    expect(buildRecipe(parseRecipe('Chutney:100 g'))).toBe('Chutney:100 gms');
  });

  it('reads the spellings a hand-typed CSV arrives with', () => {
    // The importer normalises against these, so a menu built from a CSV lands
    // in the same grammar as one built in the editor. The last import carried
    // both of these: '150ml' with no space, and 'Sweet:1n'.
    expect(toMenuUnit('n')).toBe('nos');
    expect(toMenuUnit('grams')).toBe('gms');
    expect(buildRecipe(parseRecipe('Sambar:150ml;Sweet:1n')))
      .toBe('Sambar:150 ml;Sweet:1 nos');
  });

  it('keeps an unknown spelling as an ingredient rather than dropping it', () => {
    // A wrong unit is a thing to correct; a lost ingredient is a dish that
    // silently ships short.
    expect(buildRecipe(parseRecipe('Sambar:150 litres'))).toBe('Sambar:150 nos');
  });
});

describe('a line as a count of the item’s portion', () => {
  it('reads one portion as ×1, whatever the portion is', () => {
    expect(portionCount(150, 150)).toBe(1);   // Sambar 150 ml
    expect(portionCount(100, 100)).toBe(1);   // Chutney 100 gms
    expect(portionCount(4, 1)).toBe(4);       // Idli, 4 of them
  });

  it('rounds a part-portion to three places', () => {
    // Masala Dosa takes 100 ml of a 150 ml sambar.
    expect(portionCount(100, 150)).toBe(0.667);
    expect(portionCount(200, 150)).toBe(1.333);
  });

  it('survives a missing or zero portion rather than dividing by it', () => {
    expect(portionCount(150, 0)).toBe(150);
    expect(portionCount(150, NaN)).toBe(150);
  });

  it('multiplies a typed count back out exactly', () => {
    expect(countToQty(1, 150)).toBe(150);
    expect(countToQty(2, 150)).toBe(300);
    expect(countToQty(0.5, 150)).toBe(75);
  });

  it('does NOT round-trip a part-portion — which is why the editor must not', () => {
    // The whole reason MenuEditorModal keeps the stored amount until a row's
    // count is actually typed in. Reading 100 ml as 0.667 and writing it back
    // gives 100.05, and a menu would drift a little on every save that merely
    // opened it. If this ever starts passing, that guard can be reconsidered.
    expect(countToQty(portionCount(100, 150), 150)).not.toBe(100);
    expect(countToQty(portionCount(100, 150), 150)).toBeCloseTo(100, 0);
  });

  it('does round-trip a whole portion, which is 70 of the 77 real lines', () => {
    for (const [qty, portion] of [[150, 150], [300, 150], [4, 1], [100, 100]]) {
      expect(countToQty(portionCount(qty, portion), portion)).toBe(qty);
    }
  });
});

describe('summariseRecipe', () => {
  it('names the parts, without quantities', () => {
    // The list row is for finding the right menu, not for reading a recipe.
    expect(summariseRecipe('Idli:2 nos;Sambar:150 ml')).toBe('Idli · Sambar');
  });
});
