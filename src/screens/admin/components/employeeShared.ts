/**
 * 1stOne F1 — EmployeeDetail shared bits
 *
 * Helpers and the shared tab-scroll style used by the four EmployeeDetail
 * tab components (Profile / Attendance / Leave / Salary). Extracted from
 * EmployeeDetailScreen (audit D22).
 */

import { StyleSheet } from 'react-native';
import { Theme } from '../../../theme';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatTime(iso: string | null): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

/** IST-anchored — a bare 'YYYY-MM-DD' is UTC midnight, so the device zone
 *  would shift the day back west of UTC (see utils/formatters.ts). */
export function formatDate(str: string | null): string {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// Shared tab scroll style
export const tab = StyleSheet.create({
  scroll: { paddingBottom: Theme.spacing.xl * 2 },
  sectionLabel: {
    fontSize: S,
    letterSpacing: 1,
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },
  empty: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    fontSize: B,
  },
});
