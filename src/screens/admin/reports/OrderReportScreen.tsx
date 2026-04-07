/**
 * 1stOne F1 — Order Report Screen
 *
 * Date-range order breakdown by status, cycle, type.
 * Daily order count chart. Cancellation rate.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { useOrderReport } from '../../../hooks/useReports';
import { useDeliveryCycles } from '../../../hooks/useDeliveryCycles';

type DateRange = '7d' | '30d' | '90d';

function getRange(range: DateRange): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  switch (range) {
    case '7d': start.setDate(start.getDate() - 7); break;
    case '30d': start.setDate(start.getDate() - 30); break;
    case '90d': start.setDate(start.getDate() - 90); break;
  }
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
}

export function OrderReportScreen({ navigation }: { navigation: any }) {
  const [range, setRange] = useState<DateRange>('7d');
  const { start, end } = useMemo(() => getRange(range), [range]);
  const { data: report } = useOrderReport(start, end);
  const { data: cycles } = useDeliveryCycles();

  const cycleMap = useMemo(() => {
    const m: Record<number, string> = {};
    (cycles ?? []).forEach((c) => { m[c.id] = c.cycle_name; });
    return m;
  }, [cycles]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">{'< Back'}</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Order Report</ThemedText>
        <View style={{ width: 50 }} />
      </View>

      {/* Range */}
      <View style={styles.rangeBar}>
        {(['7d', '30d', '90d'] as DateRange[]).map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.chip, range === r && styles.chipActive]}
            onPress={() => setRange(r)}
          >
            <ThemedText variant="small" color={range === r ? 'primary' : 'subtitle'}>
              {r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : '90 Days'}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>

      {/* Summary */}
      <View style={styles.summaryCard}>
        <ThemedText variant="subtitle" color="primary">
          {report?.total ?? 0} Total Orders
        </ThemedText>
        <ThemedText variant="small" color="muted">
          Cancellation rate: {(report?.cancellationRate ?? 0).toFixed(1)}%
        </ThemedText>
      </View>

      {/* By Status */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          By Status
        </ThemedText>
        {Object.entries(report?.statusBreakdown ?? {}).map(([status, count]) => (
          <View key={status} style={styles.breakdownRow}>
            <ThemedText variant="body" color="primary">{status}</ThemedText>
            <ThemedText variant="body" color="subtitle">{count as number}</ThemedText>
          </View>
        ))}
      </View>

      {/* By Cycle */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          By Cycle
        </ThemedText>
        {Object.entries(report?.cycleBreakdown ?? {}).map(([cycleId, count]) => (
          <View key={cycleId} style={styles.breakdownRow}>
            <ThemedText variant="body" color="primary">
              {cycleMap[Number(cycleId)] || `Cycle ${cycleId}`}
            </ThemedText>
            <ThemedText variant="body" color="subtitle">{count as number}</ThemedText>
          </View>
        ))}
      </View>

      {/* By Type */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          By Type
        </ThemedText>
        {Object.entries(report?.typeBreakdown ?? {}).map(([type, count]) => (
          <View key={type} style={styles.breakdownRow}>
            <ThemedText variant="body" color="primary">{type}</ThemedText>
            <ThemedText variant="body" color="subtitle">{count as number}</ThemedText>
          </View>
        ))}
      </View>

      {/* Daily Chart */}
      {(report?.daily ?? []).length > 0 && (
        <View style={styles.section}>
          <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
            Daily Orders
          </ThemedText>
          {(report?.daily ?? []).slice(-14).map((day) => {
            const max = Math.max(...(report?.daily ?? []).map((d) => d.count));
            const barW = max > 0 ? (day.count / max) * 100 : 0;
            return (
              <View key={day.date} style={styles.chartRow}>
                <ThemedText variant="micro" color="subtitle" style={styles.chartDate}>
                  {day.date.slice(5)}
                </ThemedText>
                <View style={styles.chartBarBg}>
                  <View style={[styles.chartBar, { width: `${Math.max(barW, 2)}%` }]} />
                </View>
                <ThemedText variant="micro" color="muted" style={styles.chartVal}>
                  {day.count}
                </ThemedText>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { padding: Theme.spacing.md, paddingTop: Theme.spacing.xl + Theme.spacing.md, paddingBottom: Theme.spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Theme.spacing.md },
  rangeBar: { flexDirection: 'row', gap: Theme.spacing.sm, marginBottom: Theme.spacing.md },
  chip: { flex: 1, paddingVertical: Theme.spacing.sm, borderRadius: 8, backgroundColor: Theme.colors.background.tertiary, alignItems: 'center' },
  chipActive: { backgroundColor: Theme.colors.action.primary },
  summaryCard: { backgroundColor: Theme.colors.background.secondary, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.md, marginBottom: Theme.spacing.md, alignItems: 'center' },
  section: { marginBottom: Theme.spacing.lg },
  sectionTitle: { marginBottom: Theme.spacing.sm },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: Theme.colors.layout.divider },
  chartRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Theme.spacing.xs },
  chartDate: { width: 45 },
  chartBarBg: { flex: 1, height: 12, backgroundColor: Theme.colors.background.tertiary, borderRadius: 6, marginHorizontal: Theme.spacing.xs, overflow: 'hidden' },
  chartBar: { height: '100%', backgroundColor: Theme.colors.status.info, borderRadius: 6 },
  chartVal: { width: 30, textAlign: 'right' },
});
