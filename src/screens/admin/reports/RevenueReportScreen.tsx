/**
 * 1stOne F1 — Revenue Report Screen
 *
 * Period: Weekly | Monthly | Quarterly
 * Day-level rows: Date | Orders | Revenue | Incl. GST
 *
 * Pricing is GST-inclusive (T1): Revenue is the gross amount customers
 * paid, and the GST column is the tax already CONTAINED within it — not
 * an amount added on top. Revenue is the total billed.
 * Footer: Print | Download PDF
 * Printing & PDF go through utils/printHtml (web + native).
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
import { ErrorRetry } from '../../../components/ErrorRetry';
import { printHtml, sharePdf } from '../../../utils/printHtml';
import { useRevenueDetailReport, type OrderSource } from '../../../hooks/useReports';
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

/** Order provenance filter — 'All' is the pre-existing report, unchanged. */
const SOURCES: OrderSource[] = ['all', 'bulk', 'retail'];
const SOURCE_LABEL: Record<OrderSource, string> = {
  all: 'All',
  bulk: 'Bulk',
  retail: 'Retail',
};
const SOURCE_TITLE: Record<OrderSource, string> = {
  all: '',
  bulk: ' · Bulk / B2B only',
  retail: ' · Customer-placed only',
};

function buildHtml(
  periodTitle: string,
  sourceTitle: string,
  rows: { date: string; orders: number; revenue: number; tax: number }[],
  totals: { orders: number; revenue: number; tax: number },
  // Printed too, not just shown. A PDF that says "revenue ₹40,000" while the
  // screen says we earned ₹28,000 is the version that ends up in somebody's
  // inbox, so the split has to travel with it.
  vendor?: { sales: number; commission: number; ownRevenue: number; netRevenue: number },
): string {
  const rowsHtml = rows
    .map((r) => `<tr><td>${r.date}</td><td>${r.orders}</td><td>₹${r.revenue.toLocaleString('en-IN')}</td><td>₹${r.tax.toFixed(0)}</td></tr>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>body{font-family:sans-serif;font-size:12px;padding:20px}h2{margin-bottom:4px}p{color:#666;margin-bottom:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f4f4f4}tfoot td{font-weight:bold;background:#f9f9f9}</style>
  </head><body>
  <h2>Revenue Report — ${periodTitle}${sourceTitle}</h2>
  <p>Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  <table>
    <thead><tr><th>Date</th><th>Orders</th><th>Revenue</th><th>Incl. GST</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot><tr><td>Total</td><td>${totals.orders}</td><td>₹${totals.revenue.toLocaleString('en-IN')}</td><td>₹${totals.tax.toFixed(0)}</td></tr></tfoot>
  </table>
  ${vendor && vendor.sales > 0 ? `
  <h3 style="margin-top:20px;margin-bottom:4px">Of which</h3>
  <table>
    <tbody>
      <tr><td>Our own sales</td><td>₹${Math.round(vendor.ownRevenue).toLocaleString('en-IN')}</td></tr>
      <tr><td>Vendor goods (collected, largely passed on)</td><td>₹${Math.round(vendor.sales).toLocaleString('en-IN')}</td></tr>
      <tr><td>Commission earned</td><td>₹${Math.round(vendor.commission).toLocaleString('en-IN')}</td></tr>
    </tbody>
    <tfoot><tr><td>We actually earned</td><td>₹${Math.round(vendor.netRevenue).toLocaleString('en-IN')}</td></tr></tfoot>
  </table>
  <p style="margin-top:8px">Commission is credited on delivery, so vendor orders still out for delivery are not counted here yet.</p>
  ` : ''}
  </body></html>`;
}

async function handlePrint(html: string) {
  try {
    await printHtml(html);
  } catch {
    Alert.alert('Print unavailable', 'Could not open the print dialog.');
  }
}

async function handleDownload(html: string) {
  try {
    await sharePdf(html, 'Revenue Report');
  } catch {
    Alert.alert('PDF unavailable', 'Could not export the PDF.');
  }
}

export function RevenueReportScreen({ navigation }: { navigation: AdminNavProp }) {
  const [period, setPeriod] = useState<Period>('Monthly');
  const [customRange, setCustomRange] = useState<DateRange>(defaultCustomRange);
  const [source, setSource] = useState<OrderSource>('all');
  const { start, end } = useMemo(() => getPeriodRange(period, customRange), [period, customRange]);
  const { data, isLoading, isError, refetch } = useRevenueDetailReport(start, end, source);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const totals = useMemo(
    () => data?.totals ?? { orders: 0, revenue: 0, tax: 0, vendorSales: 0 },
    [data],
  );
  // Only shown once a vendor has actually sold something. Until then these are
  // all zero and the extra block would be noise on every report.
  const vendor = data?.vendor;
  const hasVendorSales = (vendor?.sales ?? 0) > 0;
  const hasData = rows.length > 0;

  const html = useMemo(
    () => buildHtml(periodLabel(period, customRange), SOURCE_TITLE[source], rows, totals, vendor),
    [period, customRange, source, rows, totals, vendor]
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

      {/* Order source — All | Bulk | Retail */}
      <View style={styles.toggleRow}>
        {SOURCES.map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>}
            <TouchableOpacity onPress={() => setSource(s)}>
              <ThemedText
                variant="body"
                color={source === s ? 'primary' : 'muted'}
                style={[styles.txt, source === s && styles.active]}
              >
                {SOURCE_LABEL[s]}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      {/* Column header */}
      <View style={styles.colHeader}>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colDate]}>Date</ThemedText>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colOrders]}>Orders</ThemedText>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colRevenue]}>Revenue</ThemedText>
        <ThemedText variant="small" color="muted" style={[styles.sub, styles.colTax]}>Incl. GST</ThemedText>
      </View>

      {/* Rows */}
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {/* A failed fetch is not an empty period. Rendering the empty state
            here would report a real zero for revenue figures that were
            never actually loaded. */}
        {isError ? (
          <ErrorRetry message="Could not load this report" onRetry={refetch} />
        ) : (
          !isLoading && !hasData && <EmptyState title="No revenue data for this period" />
        )}

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

        {/* WHOSE MONEY IS IT. The Revenue column is gross collections — it
            includes what customers paid for a vendor's goods, which we take
            and largely pass on. Reading that as income overstates it by the
            vendor's share, and nothing on the row would look wrong. */}
        {hasData && hasVendorSales && vendor && (
          <View style={styles.vendorBox}>
            <ThemedText variant="small" color="muted" style={styles.vendorLabel}>
              OF WHICH
            </ThemedText>
            <View style={styles.vendorRow}>
              <ThemedText variant="body" color="subtitle" style={styles.txt}>Our own sales</ThemedText>
              <ThemedText variant="body" color="primary" style={styles.txt}>
                ₹{Math.round(vendor.ownRevenue).toLocaleString('en-IN')}
              </ThemedText>
            </View>
            <View style={styles.vendorRow}>
              <ThemedText variant="body" color="subtitle" style={styles.txt}>Vendor goods (collected)</ThemedText>
              <ThemedText variant="body" color="primary" style={styles.txt}>
                ₹{Math.round(vendor.sales).toLocaleString('en-IN')}
              </ThemedText>
            </View>
            <View style={styles.vendorRow}>
              <ThemedText variant="body" color="subtitle" style={styles.txt}>Commission earned</ThemedText>
              <ThemedText variant="body" color="mint" style={styles.txt}>
                ₹{Math.round(vendor.commission).toLocaleString('en-IN')}
              </ThemedText>
            </View>
            <View style={[styles.vendorRow, styles.vendorNet]}>
              <ThemedText variant="body" color="primary" style={styles.txt}>We actually earned</ThemedText>
              <ThemedText variant="subtitle" color="mint" style={styles.txt}>
                ₹{Math.round(vendor.netRevenue).toLocaleString('en-IN')}
              </ThemedText>
            </View>
            <ThemedText variant="small" color="muted" style={styles.vendorNote}>
              Commission is credited when an order is delivered, so vendor orders
              still out for delivery are not counted here yet.
            </ThemedText>
          </View>
        )}

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
  vendorBox: {
    marginTop: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  vendorLabel: { letterSpacing: 1, marginBottom: Theme.spacing.xs },
  vendorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  vendorNet: {
    marginTop: Theme.spacing.xs,
    paddingTop: Theme.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  vendorNote: { marginTop: Theme.spacing.xs },
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
  colTax: { width: 84, textAlign: 'right' },
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
