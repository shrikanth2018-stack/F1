/**
 * 1stOne F1 — CSV builder for admin export flows
 *
 * Mirror of csvParsers.ts (which reads CSV). These helpers WRITE CSV.
 * RFC 4180 escaping: cells containing comma, quote, CR, or LF are wrapped
 * in double-quotes; internal quotes are doubled. Numbers/booleans/null
 * are coerced to string in a predictable way (null → empty).
 */

export function escapeCsvCell(value: unknown): string {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  if (str === '') return '';
  const needsQuoting = /[",\r\n]/.test(str);
  if (!needsQuoting) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Build a CSV blob from a header row + body rows.
 * Each row is an array; cells are escaped per RFC 4180.
 * Line terminator: \r\n (Excel-friendly).
 */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvCell).join(','));
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
