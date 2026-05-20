/**
 * 1stOne F1 — CSV export helper
 *
 * Builds a CSV from a header row + body rows and delivers it to the user:
 *   - Native: writes to the document directory and opens the share sheet.
 *   - Web:    builds a Blob and triggers a browser download. expo-sharing
 *             is a no-op on web and FileSystem.documentDirectory is null,
 *             so the native path silently dropped the file.
 *
 * expo-file-system/legacy: SDK 54 replaced the default export with the new
 * File API; the classic documentDirectory / writeAsStringAsync live under
 * the /legacy entry.
 */

import { Platform } from 'react-native';
import { buildCsv } from './csvBuilder';

/**
 * Export rows as a CSV file. Triggers a browser download on web, the OS
 * share sheet on native.
 * @param filename  e.g. 'expense_claims_2026-05-20.csv'
 * @param headers   the header row
 * @param rows      body rows — cells RFC-4180 escaped by buildCsv
 */
export async function exportCsv(
  filename: string,
  headers: string[],
  rows: unknown[][],
): Promise<void> {
  const csv = buildCsv(headers, rows);

  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  const FileSystem = require('expo-file-system/legacy');
  const Sharing = require('expo-sharing');

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

/**
 * Export a pre-built CSV string. Same delivery split as exportCsv —
 * the import-template flow builds CSV by hand (current-cycle interpolation),
 * so it bypasses buildCsv but still needs the web / native delivery split.
 */
export async function downloadCsvString(filename: string, csv: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  const FileSystem = require('expo-file-system/legacy');
  const Sharing = require('expo-sharing');

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
