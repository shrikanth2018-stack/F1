/**
 * 1stOne F1 — Reports Dashboard
 *
 * Top-level report view with date range selector,
 * key metrics summary, and navigation to detailed reports.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { SettingsRow } from '../../../components/SettingsRow';
import { Divider } from '../../../components/Divider';
import { ErrorRetry } from '../../../components/ErrorRetry';
import { useRevenueReport, useOrderReport, useSubscriptionReport } from '../../../hooks/useReports';

type DateRange = '7d' | '30d' | '90d';

function getDateRange(range: DateRange): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  switch (range) {
    case '7d':
      start.setDate(start.getDate() - 7);
      break;
    case '30d':
      start.setDate(start.getDate() - 30);
      break;
    case '90d':
      start.setDate(start.getDate() - 90);
      break;
  }
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

function MetricCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: string;
  subtitle?: string;
  color?: string;
}) {
  return (
    <View style={styles.metricCard}>
      <ThemedText variant="small" color="subtitle">
        {label}
      </ThemedText>
      <ThemedText
        variant="header"
        color="primary"
        style={color ? { color } : undefined}
      >
        {value}
      </ThemedText>
      {subtitle && (
        <ThemedText variant="micro" color="muted">
          {subtitle}
        </ThemedText>
      )}
    </View>
  );
}

export function ReportsDashboard() {
  const navigation = useNavigation<any>();
  const [range, setRange] = useState<DateRange>('7d');
  const { start, end } = useMemo(() => getDateRange(range), [range]);

  const { data: revenue, isLoading: revLoading, isError: revError, refetch: revRefetch } = useRevenueReport(start, end);
  const { data: orders } = useOrderReport(start, end);
  const { data: subs } = useSubscriptionReport();

  const isLoading = revLoading;

  const rangeOptions: { key: DateRange; label: string }[] = [
    { key: '7d', label: '7 Days' },
    { key: '30d', label: '30 Days' },
    { key: '90d', label: '90 Days' },
  ];

  if (revError) {
    return <ErrorRetry message="Failed to load reports" onRetry={revRefetch} />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={revRefetch}
          tintColor={Theme.colors.action.primary}
        />
      }
    >
      <ThemedText variant="header" color="primary">
        Reports
      </ThemedText>

      {/* Date Range Picker */}
      <View style={styles.rangeBar}>
        {rangeOptions.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.rangeChip, range === opt.key && styles.rangeChipActive]}
            onPress={() => setRange(opt.key)}
          >
            <ThemedText
              variant="small"
              color={range === opt.key ? 'primary' : 'subtitle'}
            >
              {opt.label}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>

      <ThemedText variant="small" color="muted" style={styles.dateLabel}>
        {start} to {end}
      </ThemedText>

      {/* Revenue Summary */}
      <View style={styles.revenueCard}>
        <ThemedText variant="small" color="subtitle">
          Total Revenue
        </ThemedText>
        <ThemedText variant="title" color="primary" style={styles.revenueAmount}>
          {'\u20B9'}{(revenue?.totalRevenue ?? 0).toLocaleString('en-IN')}
        </ThemedText>
        <ThemedText variant="small" color="muted">
          {revenue?.totalOrders ?? 0} orders — Avg {'\u20B9'}{(revenue?.avgOrderValue ?? 0).toFixed(0)}/order
        </ThemedText>
      </View>

      {/* Mini Revenue Chart (text-based bar) */}
      {(revenue?.daily ?? []).length > 0 && (
        <View style={styles.chartSection}>
          <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
            Daily Revenue
          </ThemedText>
          {(revenue?.daily ?? []).slice(-7).map((day) => {
            const maxRev = Math.max(...(revenue?.daily ?? []).map((d) => d.revenue));
            const barWidth = maxRev > 0 ? (day.revenue / maxRev) * 100 : 0;
            return (
              <View key={day.date} style={styles.chartRow}>
                <ThemedText variant="micro" color="subtitle" style={styles.chartDate}>
                  {day.date.slice(5)}
                </ThemedText>
                <View style={styles.chartBarBg}>
                  <View
                    style={[
                      styles.chartBar,
                      { width: `${Math.max(barWidth, 2)}%` },
                    ]}
                  />
                </View>
                <ThemedText variant="micro" color="muted" style={styles.chartVal}>
                  {'\u20B9'}{day.revenue.toFixed(0)}
                </ThemedText>
              </View>
            );
          })}
        </View>
      )}

      {/* Key Metrics Grid */}
      <View style={styles.metricsGrid}>
        <MetricCard
          label="Total Orders"
          value={String(orders?.total ?? 0)}
        />
        <MetricCard
          label="Cancellation Rate"
          value={`${(orders?.cancellationRate ?? 0).toFixed(1)}%`}
          color={
            (orders?.cancellationRate ?? 0) > 10
              ? Theme.colors.status.error
              : Theme.colors.status.success
          }
        />
        <MetricCard
          label="Active Subs"
          value={String(subs?.active ?? 0)}
          color={Theme.colors.action.primary}
        />
        <MetricCard
          label="Tax Collected"
          value={`\u20B9${(revenue?.totalTax ?? 0).toFixed(0)}`}
        />
      </View>

      <Divider />

      {/* Navigation to Detail Reports */}
      <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
        Detailed Reports
      </ThemedText>

      <SettingsRow
        label="Order Report"
        showChevron
        onPress={() => navigation.navigate('OrderReport')}
      />
      <SettingsRow
        label="Subscription Report"
        showChevron
        onPress={() => navigation.navigate('SubscriptionReport')}
      />
      <SettingsRow
        label="Staff Report"
        showChevron
        onPress={() => navigation.navigate('StaffReport')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  content: {
    padding: Theme.spacing.md,
    paddingTop: Theme.spacing.xl + Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },
  rangeBar: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.xs,
  },
  rangeChip: {
    flex: 1,
    paddingVertical: Theme.spacing.sm,
    borderRadius: 8,
    backgroundColor: Theme.colors.background.tertiary,
    alignItems: 'center',
  },
  rangeChipActive: {
    backgroundColor: Theme.colors.action.primary,
  },
  dateLabel: {
    marginBottom: Theme.spacing.md,
  },
  revenueCard: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.lg,
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  revenueAmount: {
    marginVertical: Theme.spacing.xs,
  },
  chartSection: {
    marginBottom: Theme.spacing.md,
  },
  sectionTitle: {
    marginBottom: Theme.spacing.sm,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Theme.spacing.xs,
  },
  chartDate: {
    width: 45,
  },
  chartBarBg: {
    flex: 1,
    height: 12,
    backgroundColor: Theme.colors.background.tertiary,
    borderRadius: 6,
    marginHorizontal: Theme.spacing.xs,
    overflow: 'hidden',
  },
  chartBar: {
    height: '100%',
    backgroundColor: Theme.colors.action.primary,
    borderRadius: 6,
  },
  chartVal: {
    width: 55,
    textAlign: 'right',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
  },
  metricCard: {
    width: '48%',
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    alignItems: 'center',
    flexGrow: 1,
  },
});
