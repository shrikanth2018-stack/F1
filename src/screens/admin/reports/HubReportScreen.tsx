/**
 * 1stOne F1 — Hub Report Screen
 *
 * Period: Today | Weekly | Monthly | Quarterly
 * Shows per-hub order counts broken down by status stage,
 * plus revenue contribution and delivery completion rate.
 * Separate from existing reports — does not alter any other report.
 */

import React, { useState } from 'react';
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
import { useHubReport, type HubStat } from '../../../hooks/useHubReport';
import { formatPriceShort } from '../../../utils/formatters';

type Period = 'Today' | 'Weekly' | 'Monthly' | 'Quarterly';
const PERIODS: Period[] = ['Today', 'Weekly', 'Monthly', 'Quarterly'];

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

function getPeriodRange(period: Period) {
  const end = new Date();
  const start = new Date();
  if (period === 'Today') {
    // same start and end
  } else if (period === 'Weekly') {
    start.setDate(start.getDate() - 7);
  } else if (period === 'Monthly') {
    start.setDate(start.getDate() - 30);
  } else {
    start.setDate(start.getDate() - 90);
  }
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

function buildHtml(period: Period, hubs: HubStat[], totals: any): string {
  const rows = hubs
    .map(
      (h) =>
        `<tr>
          <td>${h.hub_name}</td>
          <td>${h.total_orders}</td>
          <td>${h.pending}</td>
          <td>${h.dispatched}</td>
          <td>${h.received_at_hub}</td>
          <td>${h.on_the_way}</td>
          <td>${h.delivered}</td>
          <td>${h.cancelled}</td>
          <td>₹${h.revenue.toLocaleString('en-IN')}</td>
          <td>${h.total_orders > 0 ? Math.round((h.delivered / h.total_orders) * 100) : 0}%</td>
        </tr>`
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    body{font-family:sans-serif;font-size:11px;padding:20px}
    h2{margin-bottom:4px}p{color:#666;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ddd;padding:5px 8px;text-align:left}
    th{background:#f4f4f4}tfoot td{font-weight:bold;background:#f9f9f9}
  </style>
  </head><body>
  <h2>Hub Delivery Report — ${period}</h2>
  <p>Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  <table>
    <thead>
      <tr>
        <th>Hub</th><th>Total</th><th>Pending</th><th>Dispatched</th>
        <th>At Hub</th><th>On the Way</th><th>Delivered</th>
        <th>Cancelled</th><th>Revenue</th><th>Completion</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td>Total</td>
        <td>${totals.total_orders}</td>
        <td>${totals.pending}</td>
        <td colspan="4"></td>
        <td>${totals.delivered}</td>
        <td></td>
        <td>₹${totals.revenue.toLocaleString('en-IN')}</td>
        <td>${totals.total_orders > 0 ? Math.round((totals.delivered / totals.total_orders) * 100) : 0}%</td>
      </tr>
    </tfoot>
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

async function handleShare(html: string) {
  try {
    const Print = require('expo-print');
    const Sharing = require('expo-sharing');
    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Hub Report' });
  } catch {
    Alert.alert('Share unavailable', 'Run: npx expo install expo-print expo-sharing');
  }
}

// ── Delivery bar — visual completion indicator ────────────
function DeliveryBar({ delivered, total }: { delivered: number; total: number }) {
  const pct = total > 0 ? delivered / total : 0;
  return (
    <View style={bar.track}>
      <View style={[bar.fill, { flex: pct }]} />
      <View style={{ flex: 1 - pct }} />
    </View>
  );
}

const bar = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    backgroundColor: Theme.colors.background.tertiary ?? Theme.colors.layout.divider,
    overflow: 'hidden',
    marginTop: 4,
  },
  fill: {
    backgroundColor: Theme.colors.status.success,
    borderRadius: 2,
  },
});

// ── Hub card ─────────────────────────────────────────────
function HubCard({ hub }: { hub: HubStat }) {
  const completionPct =
    hub.total_orders > 0 ? Math.round((hub.delivered / hub.total_orders) * 100) : 0;

  return (
    <View style={styles.card}>
      {/* Hub name + completion % */}
      <View style={styles.cardHeader}>
        <ThemedText variant="subtitle" color="primary" style={{ fontSize: B, fontWeight: '600' }}>
          {hub.hub_name}
        </ThemedText>
        <ThemedText variant="small" color="accent" style={{ fontSize: S }}>
          {completionPct}% delivered
        </ThemedText>
      </View>

      <DeliveryBar delivered={hub.delivered} total={hub.total_orders} />

      {/* Status grid */}
      <View style={styles.statusGrid}>
        <StatusCell label="Total" value={hub.total_orders} color="primary" />
        <StatusCell label="Pending" value={hub.pending} color="warning" />
        <StatusCell label="Dispatched" value={hub.dispatched} color="accent" />
        <StatusCell label="At Hub" value={hub.received_at_hub} color="info" />
        <StatusCell label="On the Way" value={hub.on_the_way} color="warning" />
        <StatusCell label="Delivered" value={hub.delivered} color="success" />
      </View>

      {/* Revenue + cancelled */}
      <View style={styles.cardFooter}>
        <ThemedText variant="small" color="muted" style={{ fontSize: S }}>
          Revenue: <ThemedText variant="small" color="accent" style={{ fontSize: S }}>
            {formatPriceShort(hub.revenue)}
          </ThemedText>
        </ThemedText>
        {hub.cancelled > 0 && (
          <ThemedText variant="small" color="muted" style={{ fontSize: S }}>
            {hub.cancelled} cancelled
          </ThemedText>
        )}
      </View>

      {/* Commission payout — only shown when hub has a contract and something is owed */}
      {hub.commission_percent != null && hub.commission_due > 0 && (
        <View style={styles.cardFooter}>
          <ThemedText variant="small" color="muted" style={{ fontSize: S }}>
            Commission ({hub.commission_percent}%): <ThemedText variant="small" color="mint" style={{ fontSize: S }}>
              {formatPriceShort(hub.commission_due)}
            </ThemedText> due
          </ThemedText>
        </View>
      )}
    </View>
  );
}

function StatusCell({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'primary' | 'accent' | 'muted' | 'warning' | 'success' | 'info';
}) {
  const colorMap: Record<string, string> = {
    primary: Theme.colors.text.primary,
    accent:  Theme.colors.text.accent,
    muted:   Theme.colors.text.muted,
    warning: Theme.colors.status.warning,
    success: Theme.colors.status.success,
    info:    Theme.colors.status.info,
  };

  return (
    <View style={styles.statusCell}>
      <ThemedText variant="body" color="primary" style={[styles.statusValue, { color: colorMap[color] }]}>
        {value}
      </ThemedText>
      <ThemedText variant="micro" color="muted" style={styles.statusLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────
export function HubReportScreen({ navigation }: any) {
  const [period, setPeriod] = useState<Period>('Weekly');
  const { start, end } = getPeriodRange(period);
  const { data, isLoading, isError, refetch } = useHubReport(start, end);

  const hubs = data?.hubs ?? [];
  const totals = data?.totals ?? { total_orders: 0, delivered: 0, revenue: 0, pending: 0 };

  const html = buildHtml(period, hubs, totals);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={{ fontSize: B }}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={{ fontSize: B + 2 }}>
          Hub Report
        </ThemedText>
        <View style={{ width: 60 }} />
      </View>

      {/* Period picker */}
      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, period === p && styles.periodBtnActive]}
            onPress={() => setPeriod(p)}
          >
            <ThemedText
              variant="small"
              color={period === p ? 'mint' : 'muted'}
              style={{ fontSize: S }}
            >
              {p}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>

      {/* Summary strip */}
      {hubs.length > 0 && (
        <View style={styles.summaryStrip}>
          <SummaryPill label="Hubs" value={String(hubs.length)} />
          <SummaryPill label="Orders" value={String(totals.total_orders)} />
          <SummaryPill label="Delivered" value={String(totals.delivered)} />
          <SummaryPill label="Revenue" value={formatPriceShort(totals.revenue)} />
        </View>
      )}

      {isError ? (
        <View style={styles.center}>
          <ThemedText variant="body" color="muted">Failed to load hub data.</ThemedText>
          <TouchableOpacity onPress={() => refetch()} style={{ marginTop: 8 }}>
            <ThemedText variant="body" color="accent">Retry ›</ThemedText>
          </TouchableOpacity>
        </View>
      ) : isLoading ? (
        <View style={styles.center}>
          <ThemedText variant="body" color="muted">Loading…</ThemedText>
        </View>
      ) : hubs.length === 0 ? (
        <EmptyState
          title="No hub orders"
          subtitle={`No hub-delivery orders found for the selected period.\nEnsure hub_delivery_active is enabled.`}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {hubs.map((hub) => (
            <HubCard key={hub.hub_id} hub={hub} />
          ))}
        </ScrollView>
      )}

      {/* Print / Share footer */}
      {hubs.length > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.footerBtn} onPress={() => handlePrint(html)}>
            <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Print</ThemedText>
          </TouchableOpacity>
          <View style={styles.footerDivider} />
          <TouchableOpacity style={styles.footerBtn} onPress={() => handleShare(html)}>
            <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Download PDF</ThemedText>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryPill}>
      <ThemedText variant="body" color="accent" style={{ fontSize: B, fontWeight: '600' }}>
        {value}
      </ThemedText>
      <ThemedText variant="micro" color="muted" style={{ fontSize: S - 2 }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  periodRow: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    gap: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  periodBtn: {
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  periodBtnActive: { borderColor: Theme.colors.text.mint },

  summaryStrip: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  summaryPill: { alignItems: 'center' },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },

  listContent: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    paddingBottom: 100,
    gap: Theme.spacing.sm,
  },

  card: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: Theme.spacing.sm,
    gap: Theme.spacing.xs,
  },
  statusCell: {
    alignItems: 'center',
    minWidth: 52,
    flex: 1,
  },
  statusValue: {
    fontSize: Theme.typography.sizes.body + 4,
    fontWeight: '700',
  },
  statusLabel: {
    fontSize: Theme.typography.sizes.small,
    marginTop: 1,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Theme.spacing.sm,
    paddingTop: Theme.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },

  footer: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  footerBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Theme.spacing.md,
  },
  footerDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
  },
});
