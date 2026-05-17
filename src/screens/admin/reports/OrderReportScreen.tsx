/**
 * 1stOne F1 — Order Report Screen
 *
 * Period: Weekly | Monthly | Quarterly
 * View:   Cycle wise | Menu wise
 * Flat day-level rows. Footer: Print | Download PDF
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
import { useOrdersDetailReport } from '../../../hooks/useReports';
import type { AdminNavProp } from '../../../navigation/types';
import {
  ReportPeriodPicker,
  defaultCustomRange,
  getPeriodRange,
  periodLabel,
  type Period,
  type DateRange,
} from '../../../components/ReportPeriodPicker';

type ViewMode = 'Cycle wise' | 'Menu wise';

const VIEWS: ViewMode[] = ['Cycle wise', 'Menu wise'];

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

async function handlePrint(html: string) {
  try {
    const Print = require('expo-print');
    await Print.printAsync({ html });
  } catch {
    Alert.alert('Print unavailable', 'Run: npx expo install expo-print expo-sharing');
  }
}

async function handleDownload(html: string, _period: Period) {
  try {
    const Print = require('expo-print');
    const Sharing = require('expo-sharing');
    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
  } catch {
    Alert.alert('PDF unavailable', 'Run: npx expo install expo-print expo-sharing');
  }
}

function buildHtml(
  viewMode: ViewMode,
  periodTitle: string,
  cycleRows: { date: string; cycleName: string; count: number }[],
  menuRows: { date: string; itemName: string; qty: number }[],
  total: number
): string {
  const isCycle = viewMode === 'Cycle wise';
  const rows = isCycle
    ? cycleRows.map((r) => `<tr><td>${r.date}</td><td>${r.cycleName}</td><td>${r.count}</td></tr>`).join('')
    : menuRows.map((r) => `<tr><td>${r.date}</td><td>${r.itemName}</td><td>${r.qty}</td></tr>`).join('');
  const col2 = isCycle ? 'Cycle' : 'Item';
  const col3 = isCycle ? 'Orders' : 'Qty';

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>body{font-family:sans-serif;font-size:12px;padding:20px}h2{margin-bottom:4px}p{color:#666;margin-bottom:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f4f4f4}tfoot td{font-weight:bold;background:#f9f9f9}</style>
  </head><body>
  <h2>Orders Report — ${periodTitle} (${viewMode})</h2>
  <p>Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  <table>
    <thead><tr><th>Date</th><th>${col2}</th><th>${col3}</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td>${total}</td></tr></tfoot>
  </table>
  </body></html>`;
}

export function OrderReportScreen({ navigation }: { navigation: AdminNavProp }) {
  const [period, setPeriod] = useState<Period>('Monthly');
  const [customRange, setCustomRange] = useState<DateRange>(defaultCustomRange);
  const [viewMode, setViewMode] = useState<ViewMode>('Cycle wise');
  const { start, end } = useMemo(() => getPeriodRange(period, customRange), [period, customRange]);
  const { data, isLoading } = useOrdersDetailReport(start, end);

  const cycleRows = data?.cycleRows ?? [];
  const menuRows = data?.menuRows ?? [];
  const total = data?.totalOrders ?? 0;
  const displayRows = viewMode === 'Cycle wise' ? cycleRows : menuRows;

  const html = useMemo(
    () => buildHtml(viewMode, periodLabel(period, customRange), cycleRows, menuRows, total),
    [viewMode, period, customRange, cycleRows, menuRows, total]
  );

  const hasData = displayRows.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Orders</ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      <ReportPeriodPicker
        period={period}
        customRange={customRange}
        onChangePeriod={setPeriod}
        onChangeCustomRange={setCustomRange}
      />

      {/* View mode toggle */}
      <View style={[styles.toggleRow, styles.toggleRowBorder]}>
        {VIEWS.map((v, i) => (
          <React.Fragment key={v}>
            {i > 0 && <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>}
            <TouchableOpacity onPress={() => setViewMode(v)}>
              <ThemedText variant="body" color={viewMode === v ? 'primary' : 'muted'}
                style={[styles.txt, viewMode === v && styles.active]}>{v}</ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      {/* Column header */}
      <View style={styles.colHeader}>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colDate]}>Date</ThemedText>
        <ThemedText variant="small" color="muted" style={[styles.sub, { flex: 1 }]}>
          {viewMode === 'Cycle wise' ? 'Cycle' : 'Item'}
        </ThemedText>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colCount]}>
          {viewMode === 'Cycle wise' ? 'Orders' : 'Qty'}
        </ThemedText>
      </View>

      {/* Rows */}
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {!isLoading && !hasData && <EmptyState title="No data for this period" />}

        {viewMode === 'Cycle wise'
          ? cycleRows.map((r, idx) => (
              <View key={idx} style={styles.dataRow}>
                <ThemedText variant="body" color="muted" style={[styles.txt, styles.colDate]}>{r.date.slice(5)}</ThemedText>
                <ThemedText variant="body" color="primary" style={[styles.txt, { flex: 1 }]}>{r.cycleName}</ThemedText>
                <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.colCount]}>{r.count}</ThemedText>
              </View>
            ))
          : menuRows.map((r, idx) => (
              <View key={idx} style={styles.dataRow}>
                <ThemedText variant="body" color="muted" style={[styles.txt, styles.colDate]}>{r.date.slice(5)}</ThemedText>
                <ThemedText variant="body" color="primary" style={[styles.txt, { flex: 1 }]}>{r.itemName}</ThemedText>
                <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.colCount]}>{r.qty}</ThemedText>
              </View>
            ))
        }

        {hasData && (
          <View style={[styles.dataRow, styles.totalsRow]}>
            <ThemedText variant="body" color="muted" style={[styles.txt, styles.colDate]}>Total</ThemedText>
            <ThemedText variant="body" color="primary" style={[styles.txt, { flex: 1 }]}>{total} orders</ThemedText>
            <View style={styles.colCount} />
          </View>
        )}
      </ScrollView>

      {/* Footer: Print | Download PDF */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={() => handlePrint(html)} disabled={!hasData}>
          <ThemedText variant="body" color={hasData ? 'mint' : 'muted'} style={styles.txt}>Print  ›</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDownload(html, period)} disabled={!hasData}>
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
  },
  toggleRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  active: {  },
  colHeader: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  dataRow: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  totalsRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
    borderBottomWidth: 0,
    marginTop: Theme.spacing.xs,
  },
  colDate: { width: 52 },
  colCount: { width: 52, textAlign: 'right' },
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
