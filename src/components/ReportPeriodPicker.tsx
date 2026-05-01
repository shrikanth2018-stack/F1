/**
 * 1stOne F1 — Shared Report Period Picker
 *
 * Used across the standard report screens (Orders, Revenue, Staff) to keep the
 * Weekly/Monthly/Quarterly toggle + Custom date range identical and edit-once.
 *
 * HubReport keeps its own period UI (it has a "Today" option and a different
 * visual style) and adds Custom inline.
 */

import React from 'react';
import { View, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

export type Period = 'Weekly' | 'Monthly' | 'Quarterly' | 'Custom';
export type DateRange = { start: string; end: string };

const PERIODS: Period[] = ['Weekly', 'Monthly', 'Quarterly', 'Custom'];

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

/** Sensible default for Custom range — last 7 days. */
export function defaultCustomRange(): DateRange {
  return { start: daysAgo(7), end: today() };
}

/** Resolve start/end ISO date strings for the given period selection. */
export function getPeriodRange(period: Period, custom: DateRange): DateRange {
  if (period === 'Custom') return custom;
  const end = today();
  if (period === 'Weekly') return { start: daysAgo(7), end };
  if (period === 'Monthly') return { start: daysAgo(30), end };
  return { start: daysAgo(90), end };
}

/** Human-readable label used in PDF titles. */
export function periodLabel(period: Period, custom: DateRange): string {
  if (period === 'Custom') return `${custom.start} to ${custom.end}`;
  return period;
}

interface Props {
  period: Period;
  customRange: DateRange;
  onChangePeriod: (p: Period) => void;
  onChangeCustomRange: (r: DateRange) => void;
}

export function ReportPeriodPicker({
  period,
  customRange,
  onChangePeriod,
  onChangeCustomRange,
}: Props) {
  return (
    <View>
      <View style={styles.toggleRow}>
        {PERIODS.map((p, i) => (
          <React.Fragment key={p}>
            {i > 0 && <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>}
            <TouchableOpacity onPress={() => onChangePeriod(p)}>
              <ThemedText
                variant="body"
                color={period === p ? 'primary' : 'muted'}
                style={[styles.txt, period === p && styles.active]}
              >
                {p}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      {period === 'Custom' && (
        <View style={styles.customRow}>
          <View style={styles.dateField}>
            <ThemedText variant="small" color="muted" style={styles.dateLabel}>FROM</ThemedText>
            <TextInput
              value={customRange.start}
              onChangeText={(start) => onChangeCustomRange({ ...customRange, start })}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Theme.colors.text.muted}
              style={[styles.dateInput, { fontSize: B }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.dateField}>
            <ThemedText variant="small" color="muted" style={styles.dateLabel}>TO</ThemedText>
            <TextInput
              value={customRange.end}
              onChangeText={(end) => onChangeCustomRange({ ...customRange, end })}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Theme.colors.text.muted}
              style={[styles.dateInput, { fontSize: B }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  txt: { fontSize: B },
  active: { fontWeight: '600' },
  customRow: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    gap: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  dateField: { flex: 1 },
  dateLabel: { fontSize: S, marginBottom: 4, letterSpacing: 1 },
  dateInput: {
    fontFamily: Theme.typography.fontFamily,
    color: Theme.colors.text.primary,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
});
