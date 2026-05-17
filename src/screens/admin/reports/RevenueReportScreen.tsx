/**
 * 1stOne F1 — Revenue Report Screen
 *
 * Period: Weekly | Monthly | Quarterly
 * Day-level rows: Date | Orders | Revenue | Tax
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
import { useRevenueDetailReport } from '../../../hooks/useReports';
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
  rows: { date: string; orders: number; revenue: number; tax: number }[],
  totals: { orders: number; revenue: number; tax: number }
): string {
  const rowsHtml = rows
    .map((r) => `<tr><td>${r.date}</td><td>${r.orders}</td><td>₹${r.revenue.toLocaleString('en-IN')}</td><td>₹${r.tax.toFixed(0)}</td></tr>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>body{font-family:sans-serif;font-size:12px;padding:20px}h2{margin-bottom:4px}p{color:#666;margin-bottom:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f4f4f4}tfoot td{font-weight:bold;background:#f9f9f9}</style>
  </head><body>
  <h2>Revenue Report — ${periodTitle}</h2>
  <p>Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  <table>
    <thead><tr><th>Date</th><th>Orders</th><th>Revenue</th><th>Tax</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot><tr><td>Total</td><td>${totals.orders}</td><td>₹${totals.revenue.toLocaleString('en-IN')}</td><td>₹${totals.tax.toFixed(0)}</td></tr></tfoot>
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

export function RevenueReportScreen({ navigation }: { navigation: AdminNavProp }) {
  const [period, setPeriod] = useState<Period>('Monthly');
  const [customRange, setCustomRange] = useState<DateRange>(defaultCustomRange);
  const { start, end } = useMemo(() => getPeriodRange(period, customRange), [period, customRange]);
  const { data, isLoading } = useRevenueDetailReport(start, end);

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { orders: 0, revenue: 0, tax: 0 };
  const hasData = rows.length > 0;

  const html = useMemo(
    () => buildHtml(periodLabel(period, customRange), rows, totals),
    [period, customRange, rows, totals]
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Revenue Report</ThemedText>
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
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colDate]}>Date</ThemedText>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colOrders]}>Orders</ThemedText>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colRevenue]}>Revenue</ThemedText>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colTax]}>Tax</ThemedText>
      </View>

      {/* Rows */}
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {!isLoading && !hasData && <EmptyState title="No revenue data for this period" />}

        {rows.map((row) => (
          <View key={row.date} style={styles.dataRow}>
            <ThemedText variant="body" color="muted" style={[styles.txt, styles.colDate]}>{row.date.slice(5)}</ThemedText>
            <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.colOrders]}>{row.orders}</ThemedText>
            <ThemedText variant="body" color="primary" style={[styles.txt, styles.colRevenue]}>
              ₹{row.revenue.toLocaleString('en-IN')}
            </ThemedText>
            <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.colTax]}>
              ₹{row.tax.toFixed(0)}
            </ThemedText>
          </View>
        ))}

        {hasData && (
          <View style={[styles.dataRow, styles.totalsRow]}>
            <ThemedText variant="body" color="muted" style={[styles.txt, styles.colDate]}>Total</ThemedText>
            <ThemedText variant="body" color="primary" style={[styles.txt, styles.colOrders]}>{totals.orders}</ThemedText>
            <ThemedText variant="body" color="mint" style={[styles.txt, styles.colRevenue]}>
              ₹{totals.revenue.toLocaleString('en-IN')}
            </ThemedText>
            <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.colTax]}>
              ₹{totals.tax.toFixed(0)}
            </ThemedText>
          </View>
        )}
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
  colOrders: { width: 52, textAlign: 'right' },
  colRevenue: { flex: 1, textAlign: 'right' },
  colTax: { width: 64, textAlign: 'right' },
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
