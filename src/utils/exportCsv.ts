/**
 * 1stOne F1 — CSV export helper
 *
 * Builds a CSV from a header row + body rows, writes it to the app's
 * document directory, and opens the OS share sheet so the admin can save
 * or send it.
 *
 * expo-file-system/legacy: SDK 54 replaced the default export with the new
 * File API; the classic documentDirectory / writeAsStringAsync live under
 * the /legacy entry.
 */

import { buildCsv } from './csvBuilder';

/**
 * Export rows as a CSV file via the share sheet.
 * @param filename  e.g. 'expense_claims_2026-05-20.csv'
 * @param headers   the header row
 * @param rows      body rows — cells RFC-4180 escaped by buildCsv
 */
export async function exportCsv(
  filename: string,
  headers: string[],
  rows: unknown[][],
): Promise<void> {
  const FileSystem = require('expo-file-system/legacy');
  const Sharing = require('expo-sharing');

  const csv = buildCsv(headers, rows);
  const uri = FileSystem.documentDirectory + filename;
  await FileSystem.writeAsStringAsync(uri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await Sharing.shareAsync(uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
    dialogTitle: 'Save CSV',
  });
}
