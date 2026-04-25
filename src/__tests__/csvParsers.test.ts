import {
  parseCoreItems,
  parseMenuCsv,
  parseEssentialsCsv,
  parsePlansCsv,
  splitCsvLine,
} from '@/utils/csvParsers';

describe('splitCsvLine', () => {
  it('splits a plain comma-separated line', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('preserves embedded commas inside double quotes', () => {
    expect(splitCsvLine('"Idli, Sambar Combo",Breakfast,120')).toEqual([
      'Idli, Sambar Combo',
      'Breakfast',
      '120',
    ]);
  });

  it('handles escaped double quotes via "" → "', () => {
    expect(splitCsvLine('"He said ""hi""",Breakfast')).toEqual([
      'He said "hi"',
      'Breakfast',
    ]);
  });

  it('returns empty trailing field for line ending in comma', () => {
    expect(splitCsvLine('a,b,')).toEqual(['a', 'b', '']);
  });

  it('returns empty leading field for line starting with comma', () => {
    expect(splitCsvLine(',b,c')).toEqual(['', 'b', 'c']);
  });

  it('returns one element for a line with no commas', () => {
    expect(splitCsvLine('hello')).toEqual(['hello']);
  });

  it('returns one empty element for an empty line', () => {
    expect(splitCsvLine('')).toEqual(['']);
  });

  it('handles a fully-quoted single field', () => {
    expect(splitCsvLine('"hello world"')).toEqual(['hello world']);
  });
});

describe('parseCoreItems', () => {
  it('returns empty array for empty input', () => {
    expect(parseCoreItems('')).toEqual([]);
  });

  it('parses single item with quantity', () => {
    expect(parseCoreItems('Idli:2')).toEqual([{ name: 'Idli', quantity: 2 }]);
  });

  it('parses multiple items separated by semicolons', () => {
    expect(parseCoreItems('Idli:2;Sambar:100;Chutney:30')).toEqual([
      { name: 'Idli', quantity: 2 },
      { name: 'Sambar', quantity: 100 },
      { name: 'Chutney', quantity: 30 },
    ]);
  });

  it('defaults quantity to 1 when missing', () => {
    expect(parseCoreItems('Pickle')).toEqual([{ name: 'Pickle', quantity: 1 }]);
  });

  it('defaults quantity to 1 when not a number', () => {
    expect(parseCoreItems('Pickle:abc')).toEqual([{ name: 'Pickle', quantity: 1 }]);
  });

  it('skips empty chunks from trailing semicolons', () => {
    expect(parseCoreItems('Idli:2;;Sambar:100;')).toEqual([
      { name: 'Idli', quantity: 2 },
      { name: 'Sambar', quantity: 100 },
    ]);
  });

  it('trims whitespace in names and quantities', () => {
    expect(parseCoreItems('  Idli : 2 ;  Sambar : 100  ')).toEqual([
      { name: 'Idli', quantity: 2 },
      { name: 'Sambar', quantity: 100 },
    ]);
  });

  it('drops items with empty names', () => {
    expect(parseCoreItems(':5;Sambar:1')).toEqual([{ name: 'Sambar', quantity: 1 }]);
  });
});

describe('parseMenuCsv', () => {
  it('skips header and parses one data row', () => {
    const csv = 'Menu Name,Cycle,Sub-Items,Price\nTiffin,Breakfast,Idli:2,120';
    expect(parseMenuCsv(csv)).toEqual([
      { name: 'Tiffin', cycle_name: 'Breakfast', ingredients: 'Idli:2', price: 120 },
    ]);
  });

  it('returns empty when only header is present', () => {
    expect(parseMenuCsv('Menu Name,Cycle,Sub-Items,Price')).toEqual([]);
  });

  it('skips lines missing name or cycle', () => {
    const csv =
      'Menu Name,Cycle,Sub-Items,Price\n' +
      'Tiffin,Breakfast,Idli:2,120\n' +
      ',Lunch,Rice:200,150\n' + // no name → skip
      'Snack,,Bun:1,30';        // no cycle → skip
    expect(parseMenuCsv(csv)).toHaveLength(1);
  });

  it('coerces invalid price to 0', () => {
    const csv = 'Menu Name,Cycle,Sub-Items,Price\nTiffin,Breakfast,Idli:2,not-a-number';
    expect(parseMenuCsv(csv)[0]?.price).toBe(0);
  });

  it('handles trailing newlines and blank rows', () => {
    const csv =
      'Menu Name,Cycle,Sub-Items,Price\n' +
      'Tiffin,Breakfast,Idli:2,120\n' +
      '\n\n' +
      'Meal,Lunch,Rice:200,150\n';
    expect(parseMenuCsv(csv)).toHaveLength(2);
  });

  it('keeps embedded comma inside quoted name field (real-world bug class)', () => {
    const csv =
      'Menu Name,Cycle,Sub-Items,Price\n' +
      '"Idli, Sambar Combo",Breakfast,Idli:2;Sambar:100,120';
    const rows = parseMenuCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Idli, Sambar Combo');
    expect(rows[0]?.cycle_name).toBe('Breakfast');
    expect(rows[0]?.price).toBe(120);
  });

  it('handles Windows CRLF line endings', () => {
    const csv =
      'Menu Name,Cycle,Sub-Items,Price\r\n' +
      'Tiffin,Breakfast,Idli:2,120\r\n' +
      'Meal,Lunch,Rice:200,150\r\n';
    expect(parseMenuCsv(csv)).toHaveLength(2);
  });

  it('strips UTF-8 BOM from header (Excel-saved CSVs)', () => {
    const csv =
      '﻿Menu Name,Cycle,Sub-Items,Price\n' +
      'Tiffin,Breakfast,Idli:2,120';
    expect(parseMenuCsv(csv)).toHaveLength(1);
  });

  it('handles escaped quotes in name (RFC 4180 "" → ")', () => {
    const csv =
      'Menu Name,Cycle,Sub-Items,Price\n' +
      '"He said ""special""",Breakfast,X:1,99';
    expect(parseMenuCsv(csv)[0]?.name).toBe('He said "special"');
  });
});

describe('parseEssentialsCsv', () => {
  it('parses essentials rows with unit', () => {
    const csv =
      'Item Name,Cycle,Price,Unit\n' +
      'Full Cream Milk,Morning,45,1L\n' +
      'Bread,Morning,35,400g';
    expect(parseEssentialsCsv(csv)).toEqual([
      { name: 'Full Cream Milk', cycle_name: 'Morning', price: 45, unit: '1L' },
      { name: 'Bread', cycle_name: 'Morning', price: 35, unit: '400g' },
    ]);
  });

  it('drops rows missing name', () => {
    const csv = 'Item Name,Cycle,Price,Unit\n,Morning,45,1L';
    expect(parseEssentialsCsv(csv)).toEqual([]);
  });

  it('treats empty unit as empty string (not undefined)', () => {
    const csv = 'Item Name,Cycle,Price,Unit\nButter,Morning,60,';
    expect(parseEssentialsCsv(csv)[0]?.unit).toBe('');
  });

  it('strips CRLF before parsing price (so price comes through clean)', () => {
    const csv = 'Item Name,Cycle,Price,Unit\r\nMilk,Morning,45,1L\r\n';
    expect(parseEssentialsCsv(csv)[0]?.price).toBe(45);
  });

  it('handles quoted unit field that contains a comma', () => {
    const csv = 'Item Name,Cycle,Price,Unit\nDal Pack,Morning,200,"1kg, mixed"';
    expect(parseEssentialsCsv(csv)[0]?.unit).toBe('1kg, mixed');
  });
});

describe('parsePlansCsv', () => {
  it('parses food plan with core items', () => {
    const csv =
      'Plan Name,Cycle,Type,Days,Price,Core,Savings\n' +
      'Food 30,Breakfast,food,30,2000,Tiffin:1,400';
    expect(parsePlansCsv(csv)).toEqual([
      {
        name: 'Food 30',
        cycle_name: 'Breakfast',
        type: 'food',
        duration_days: 30,
        price: 2000,
        core_items: [{ name: 'Tiffin', quantity: 1 }],
        savings_amount: 400,
      },
    ]);
  });

  it('defaults type to "food" for unknown / empty values', () => {
    const csv =
      'Plan Name,Cycle,Type,Days,Price,Core,Savings\n' +
      'P1,Breakfast,,30,1000,X:1,0\n' +
      'P2,Breakfast,gibberish,30,1000,X:1,0';
    const rows = parsePlansCsv(csv);
    expect(rows[0]?.type).toBe('food');
    expect(rows[1]?.type).toBe('food');
  });

  it('detects "essentials" type case-insensitively', () => {
    const csv =
      'Plan Name,Cycle,Type,Days,Price,Core,Savings\n' +
      'P1,Morning,ESSENTIALS,30,1000,Milk:1,0';
    expect(parsePlansCsv(csv)[0]?.type).toBe('essentials');
  });

  it('defaults duration_days to 30 when invalid', () => {
    const csv =
      'Plan Name,Cycle,Type,Days,Price,Core,Savings\n' +
      'P1,Breakfast,food,abc,1000,X:1,0';
    expect(parsePlansCsv(csv)[0]?.duration_days).toBe(30);
  });

  it('handles missing core_items column gracefully', () => {
    // Only 6 fields instead of 7 — coreItemsRaw is undefined
    const csv =
      'Plan Name,Cycle,Type,Days,Price,Core,Savings\n' +
      'P1,Breakfast,food,30,1000';
    expect(parsePlansCsv(csv)[0]?.core_items).toEqual([]);
  });

  it('parses multiple core items in a plan row', () => {
    const csv =
      'Plan Name,Cycle,Type,Days,Price,Core,Savings\n' +
      'P1,Morning,essentials,30,1500,Milk:1;Bread:2;Eggs:6,150';
    const row = parsePlansCsv(csv)[0];
    expect(row?.core_items).toEqual([
      { name: 'Milk', quantity: 1 },
      { name: 'Bread', quantity: 2 },
      { name: 'Eggs', quantity: 6 },
    ]);
  });
});
