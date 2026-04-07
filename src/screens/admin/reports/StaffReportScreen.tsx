/**
 * 1stOne F1 — Staff Report Screen
 *
 * Attendance summary per staff + expense breakdown by category.
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
import { EmptyState } from '../../../components/EmptyState';
import { Divider } from '../../../components/Divider';
import { useStaffAttendanceReport, useExpenseReport } from '../../../hooks/useReports';

type DateRange = '7d' | '30d';

function getRange(range: DateRange): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (range === '7d' ? 7 : 30));
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
}

export function StaffReportScreen({ navigation }: { navigation: any }) {
  const [range, setRange] = useState<DateRange>('30d');
  const { start, end } = useMemo(() => getRange(range), [range]);

  const { data: attendance } = useStaffAttendanceReport(start, end);
  const { data: expenses } = useExpenseReport(start, end);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">{'< Back'}</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Staff Report</ThemedText>
        <View style={{ width: 50 }} />
      </View>

      {/* Range */}
      <View style={styles.rangeBar}>
        {(['7d', '30d'] as DateRange[]).map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.chip, range === r && styles.chipActive]}
            onPress={() => setRange(r)}
          >
            <ThemedText variant="small" color={range === r ? 'primary' : 'subtitle'}>
              {r === '7d' ? '7 Days' : '30 Days'}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>

      {/* Attendance Summary */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          Attendance Summary
        </ThemedText>

        {(attendance?.staffSummary ?? []).length === 0 ? (
          <EmptyState message="No attendance data" />
        ) : (
          (attendance?.staffSummary ?? []).map((s) => (
            <View key={s.staffId} style={styles.staffCard}>
              <ThemedText variant="body" color="primary">
                {s.name}
              </ThemedText>
              <View style={styles.staffStats}>
                <View style={styles.staffStat}>
                  <ThemedText variant="small" color="subtitle">Days</ThemedText>
                  <ThemedText variant="subtitle" color="primary">{s.daysPresent}</ThemedText>
                </View>
                <View style={styles.staffStat}>
                  <ThemedText variant="small" color="subtitle">Total Hrs</ThemedText>
                  <ThemedText variant="subtitle" color="primary">{s.totalHours.toFixed(1)}</ThemedText>
                </View>
                <View style={styles.staffStat}>
                  <ThemedText variant="small" color="subtitle">Avg Hrs/Day</ThemedText>
                  <ThemedText variant="subtitle" color="primary">{s.avgHoursPerDay.toFixed(1)}</ThemedText>
                </View>
              </View>
            </View>
          ))
        )}
      </View>

      <Divider />

      {/* Expense Summary */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          Expense Claims
        </ThemedText>

        <View style={styles.expenseOverview}>
          <View style={styles.expenseItem}>
            <ThemedText variant="small" color="subtitle">Approved</ThemedText>
            <ThemedText variant="subtitle" color="primary" style={{ color: Theme.colors.status.success }}>
              {'\u20B9'}{(expenses?.approvedAmount ?? 0).toFixed(0)}
            </ThemedText>
            <ThemedText variant="micro" color="muted">{expenses?.approvedCount ?? 0} claims</ThemedText>
          </View>
          <View style={styles.expenseItem}>
            <ThemedText variant="small" color="subtitle">Pending</ThemedText>
            <ThemedText variant="subtitle" color="primary" style={{ color: Theme.colors.status.warning }}>
              {'\u20B9'}{(expenses?.pendingAmount ?? 0).toFixed(0)}
            </ThemedText>
            <ThemedText variant="micro" color="muted">{expenses?.pendingCount ?? 0} claims</ThemedText>
          </View>
          <View style={styles.expenseItem}>
            <ThemedText variant="small" color="subtitle">Rejected</ThemedText>
            <ThemedText variant="subtitle" color="primary" style={{ color: Theme.colors.status.error }}>
              {'\u20B9'}{(expenses?.rejectedAmount ?? 0).toFixed(0)}
            </ThemedText>
            <ThemedText variant="micro" color="muted">{expenses?.rejectedCount ?? 0} claims</ThemedText>
          </View>
        </View>

        {/* By Category */}
        {Object.entries(expenses?.categoryBreakdown ?? {}).length > 0 && (
          <View style={styles.catSection}>
            <ThemedText variant="small" color="subtitle" style={styles.catTitle}>
              By Category
            </ThemedText>
            {Object.entries(expenses?.categoryBreakdown ?? {}).map(([cat, amount]) => (
              <View key={cat} style={styles.catRow}>
                <ThemedText variant="body" color="primary">{cat}</ThemedText>
                <ThemedText variant="body" color="subtitle">
                  {'\u20B9'}{(amount as number).toFixed(0)}
                </ThemedText>
              </View>
            ))}
          </View>
        )}
      </View>
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
  section: { marginBottom: Theme.spacing.lg },
  sectionTitle: { marginBottom: Theme.spacing.sm },
  staffCard: { backgroundColor: Theme.colors.background.secondary, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.md, marginBottom: Theme.spacing.sm },
  staffStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Theme.spacing.sm },
  staffStat: { alignItems: 'center' },
  expenseOverview: { flexDirection: 'row', gap: Theme.spacing.sm, marginBottom: Theme.spacing.md },
  expenseItem: { flex: 1, backgroundColor: Theme.colors.background.secondary, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.md, alignItems: 'center' },
  catSection: { marginTop: Theme.spacing.sm },
  catTitle: { marginBottom: Theme.spacing.xs },
  catRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: Theme.colors.layout.divider },
});
