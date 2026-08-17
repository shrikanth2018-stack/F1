/**
 * Tests for src/utils/csvBuilder.ts — the writer half of the CSV pair
 * (csvParsers.ts reads).
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. Every admin export goes through here:
 * the customer list, the vendor list, expense claims. A cell that is not
 * escaped does not fail loudly — it shifts every following column by one, so a
 * customer's landmark ends up under "phone" and the file still opens perfectly
 * in Excel. Indian addresses contain commas as a matter of course, so this is
 * the normal case, not an edge case.
 */

import { buildCsv } from '../utils/csvBuilder';

describe('buildCsv', () => {
  it('writes a header row and body rows, CRLF terminated', () => {
    // \r\n, not \n: Excel on Windows treats a bare \n file as one long row.
    expect(buildCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n1,2\r\n');
  });

  it('always ends with a terminator, even with no rows', () => {
    expect(buildCsv(['a', 'b'], [])).toBe('a,b\r\n');
  });

  it('quotes a cell containing a comma — the address case', () => {
    // The one that silently corrupts an export if missed.
    expect(buildCsv(['addr'], [['Near Honda showroom, Shiralagi']]))
      .toBe('addr\r\n"Near Honda showroom, Shiralagi"\r\n');
  });

  it('doubles internal quotes and wraps the cell', () => {
    expect(buildCsv(['x'], [['he said "hi"']])).toBe('x\r\n"he said ""hi"""\r\n');
  });

  it('quotes cells containing CR or LF, so one cell cannot become two rows', () => {
    expect(buildCsv(['note'], [['line one\nline two']]))
      .toBe('note\r\n"line one\nline two"\r\n');
    expect(buildCsv(['note'], [['a\rb']])).toBe('note\r\n"a\rb"\r\n');
  });

  it('writes null and undefined as empty, not as the words', () => {
    // A literal "null" in a spreadsheet column reads as data.
    expect(buildCsv(['a', 'b', 'c'], [[null, undefined, '']])).toBe('a,b,c\r\n,,\r\n');
  });

  it('coerces numbers and booleans predictably', () => {
    expect(buildCsv(['n', 'b'], [[0, false]])).toBe('n,b\r\n0,false\r\n');
    // 0 and false must survive — a truthiness check here would blank them.
    expect(buildCsv(['n'], [[0]])).not.toBe('n\r\n\r\n');
  });

  it('leaves an ordinary cell unquoted', () => {
    expect(buildCsv(['a'], [['plain']])).toBe('a\r\nplain\r\n');
  });

  it('escapes headers too, not just body cells', () => {
    expect(buildCsv(['total, incl GST'], [['1']])).toBe('"total, incl GST"\r\n1\r\n');
  });

  it('round-trips through a naive splitter only when nothing needed quoting', () => {
    // Documents the contract rather than testing the splitter: a consumer that
    // splits on ',' is correct ONLY for unquoted data. Hence the quoting above.
    const csv = buildCsv(['a', 'b'], [['1', '2']]);
    const body = csv.trimEnd().split('\r\n')[1];
    expect(body.split(',')).toEqual(['1', '2']);
  });
});
