/**
 * 1stOne F1 — Staff Report Screen
 *
 * Period: Weekly | Monthly | Quarterly
 * Flat rows: Name | Days Present | Total Hours
 * Footer: Print | Download PDF
 * Requires: npx expo install expo-print expo-sharing
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { EmptyState } from '../../../components/EmptyState';
import { useStaffAttendanceReport } from '../../../hooks/useReports';
import type { AdminNavProp } from '../../../navigation/types';
import {
  ReportPeriodPicker,
  defaultCustomRange,
  getPeriodRange,
  periodLabel,
  type Period,
  type DateRange,
} from '../../../components/ReportPeriodPicker';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

function buildHtml(
  periodTitle: string,
  staffSummary: { staffId: string; name: string; daysPresent: number; totalHours: number; avgHoursPerDay: number }[]
): string {
  const rows = staffSummary
    .map((s) => `<tr><td>${s.name}</td><td>${s.daysPresent}</td><td>${s.totalHours.toFixed(1)}</td><td>${s.avgHoursPerDay.toFixed(1)}</td></tr>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>body{font-family:sans-serif;font-size:12px;padding:20px}h2{margin-bottom:4px}p{color:#666;margin-bottom:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f4f4f4}</style>
  </head><body>
  <h2>Staff Report — ${periodTitle}</h2>
  <p>Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  <table>
    <thead><tr><th>Name</th><th>Days Present</th><th>Total Hours</th><th>Avg Hrs/Day</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </body></html>`;
}

async function handlePrint(html: string) {
  try {
    const Print = require('expo-print');
    await Print.printAsync({ html });
  } catch {
    Alert.alert('Print unavailable', 'Run: npx expo install expo-print expo-sharing');
  }
}

async function handleDownload(html: string) {
  try {
    const Print = require('expo-print');
    const Sharing = require('expo-sharing');
    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
  } catch {
    Alert.alert('PDF unavailable', 'Run: npx expo install expo-print expo-sharing');
  }
}

export function StaffReportScreen({ navigation }: { navigation: AdminNavProp }) {
  const [period, setPeriod] = useState<Period>('Monthly');
  const [customRange, setCustomRange] = useState<DateRange>(defaultCustomRange);
  const { start, end } = useMemo(() => getPeriodRange(period, customRange), [period, customRange]);
  const { data, isLoading } = useStaffAttendanceReport(start, end);

  const staffSummary = data?.staffSummary ?? [];
  const hasData = staffSummary.length > 0;

  const html = useMemo(
    () => buildHtml(periodLabel(period, customRange), staffSummary),
    [period, customRange, staffSummary]
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Staff Report</ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      <ReportPeriodPicker
        period={period}
        customRange={customRange}
        onChangePeriod={setPeriod}
        onChangeCustomRange={setCustomRange}
      />

      {/* Column header */}
      <View style={styles.colHeader}>
        <ThemedText variant="small" color="muted" style={[styles.sub, { flex: 1 }]}>Name</ThemedText>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colDays]}>Days</ThemedText>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colHours]}>Total Hrs</ThemedText>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colAvg]}>Avg/Day</ThemedText>
      </View>

      {/* Rows */}
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {!isLoading && !hasData && <EmptyState title="No attendance data for this period" />}

        {staffSummary.map((s) => (
          <View key={s.staffId} style={styles.dataRow}>
            <ThemedText variant="body" color="primary" style={[styles.txt, { flex: 1 }]} numberOfLines={1}>
              {s.name}
            </ThemedText>
            <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.colDays]}>{s.daysPresent}</ThemedText>
            <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.colHours]}>{s.totalHours.toFixed(1)}</ThemedText>
            <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.colAvg]}>{s.avgHoursPerDay.toFixed(1)}</ThemedText>
          </View>
        ))}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={() => handlePrint(html)} disabled={!hasData}>
          <ThemedText variant="body" color={hasData ? 'mint' : 'muted'} style={styles.txt}>Print  ›</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDownload(html)} disabled={!hasData}>
          <ThemedText variant="body" color={hasData ? 'mint' : 'muted'} style={styles.txt}>Download PDF  ›</ThemedText>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  title: { flex: 1, textAlign: 'center' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  active: { fontWeight: '600' },
  colHeader: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  colDays: { width: 44, textAlign: 'right' },
  colHours: { width: 64, textAlign: 'right' },
  colAvg: { width: 52, textAlign: 'right' },
  list: { paddingBottom: Theme.spacing.xl },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
  txt: { fontSize: B },
  sub: { fontSize: S },
});
