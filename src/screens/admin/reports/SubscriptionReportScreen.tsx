/**
 * 1stOne F1 — Subscription Report Screen
 *
 * Overall status (active/paused/cancelled) as flat rows.
 * Plan-wise breakdown table.
 * Footer: Print | Download PDF
 * Requires: npx expo install expo-print expo-sharing
 */

import React, { useMemo } from 'react';
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
import { useSubscriptionReport, useSubscriptionPlanReport } from '../../../hooks/useReports';
import type { AdminNavProp } from '../../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

function buildHtml(
  overview: { total: number; active: number; paused: number; cancelled: number; totalSkippedDays: number },
  plans: { planName: string; active: number; paused: number; cancelled: number }[]
): string {
  const planRows = plans
    .map((p) => `<tr><td>${p.planName}</td><td>${p.active}</td><td>${p.paused}</td><td>${p.cancelled}</td><td>${p.active + p.paused + p.cancelled}</td></tr>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>body{font-family:sans-serif;font-size:12px;padding:20px}h2{margin-bottom:4px}p{color:#666;margin-bottom:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f4f4f4}tfoot td{font-weight:bold;background:#f9f9f9}</style>
  </head><body>
  <h2>Subscription Report</h2>
  <p>Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  <h3>Overview</h3>
  <p>Total: ${overview.total} &nbsp;|&nbsp; Active: ${overview.active} &nbsp;|&nbsp; Paused: ${overview.paused} &nbsp;|&nbsp; Cancelled: ${overview.cancelled} &nbsp;|&nbsp; Skipped days: ${overview.totalSkippedDays}</p>
  <h3>By Plan</h3>
  <table>
    <thead><tr><th>Plan</th><th>Active</th><th>Paused</th><th>Cancelled</th><th>Total</th></tr></thead>
    <tbody>${planRows}</tbody>
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

export function SubscriptionReportScreen({ navigation }: { navigation: AdminNavProp }) {
  const { data: overview, isLoading } = useSubscriptionReport();
  const { data: plans = [] } = useSubscriptionPlanReport();

  const hasData = (overview?.total ?? 0) > 0;

  const html = useMemo(() => buildHtml(
    { total: overview?.total ?? 0, active: overview?.active ?? 0, paused: overview?.paused ?? 0, cancelled: overview?.cancelled ?? 0, totalSkippedDays: overview?.totalSkippedDays ?? 0 },
    plans
  ), [overview, plans]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Subscriptions</ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {!isLoading && !hasData && <EmptyState title="No subscription data" />}

        {/* Overview rows */}
        {hasData && (
          <>
            <View style={styles.sectionLabel}>
              <ThemedText variant="small" color="muted" style={[styles.sub, styles.labelText]}>OVERVIEW</ThemedText>
            </View>
            {[
              { label: 'Total', value: overview?.total ?? 0, color: undefined },
              { label: 'Active', value: overview?.active ?? 0, color: Theme.colors.status.success },
              { label: 'Paused', value: overview?.paused ?? 0, color: Theme.colors.status.warning },
              { label: 'Cancelled', value: overview?.cancelled ?? 0, color: Theme.colors.status.error },
              { label: 'Total skipped days', value: overview?.totalSkippedDays ?? 0, color: undefined },
            ].map((row) => (
              <View key={row.label} style={styles.dataRow}>
                <ThemedText variant="body" color="subtitle" style={styles.txt}>{row.label}</ThemedText>
                <ThemedText variant="body" color="primary" style={[styles.txt, row.color ? { color: row.color } : undefined]}>
                  {row.value}
                </ThemedText>
              </View>
            ))}

            {/* Plan-wise table */}
            {plans.length > 0 && (
              <>
                <View style={styles.sectionLabel}>
                  <ThemedText variant="small" color="muted" style={[styles.sub, styles.labelText]}>BY PLAN</ThemedText>
                </View>

                {/* Plan column header */}
                <View style={styles.colHeader}>
                  <ThemedText variant="small" color="muted" style={[styles.sub, { flex: 1 }]}>Plan</ThemedText>
                  <ThemedText variant="small" color="muted" style={[styles.sub, styles.planCol]}>Active</ThemedText>
                  <ThemedText variant="small" color="muted" style={[styles.sub, styles.planCol]}>Paused</ThemedText>
                  <ThemedText variant="small" color="muted" style={[styles.sub, styles.planCol]}>Canc.</ThemedText>
                  <ThemedText variant="small" color="muted" style={[styles.sub, styles.planCol]}>Total</ThemedText>
                </View>

                {plans.map((plan, idx) => (
                  <View key={idx} style={styles.dataRow}>
                    <ThemedText variant="body" color="primary" style={[styles.txt, { flex: 1 }]}>{plan.planName}</ThemedText>
                    <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.planCol]}>{plan.active}</ThemedText>
                    <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.planCol]}>{plan.paused}</ThemedText>
                    <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.planCol]}>{plan.cancelled}</ThemedText>
                    <ThemedText variant="body" color="primary" style={[styles.txt, styles.planCol]}>
                      {plan.active + plan.paused + plan.cancelled}
                    </ThemedText>
                  </View>
                ))}
              </>
            )}
          </>
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
  sectionLabel: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  labelText: { letterSpacing: 1 },
  colHeader: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  planCol: { width: 48, textAlign: 'right' },
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
