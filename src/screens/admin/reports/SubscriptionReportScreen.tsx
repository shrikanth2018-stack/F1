/**
 * 1stOne F1 — Subscription Report Screen
 *
 * Active/paused/cancelled breakdown, skipped days, payment method split.
 */

import React from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { useSubscriptionReport } from '../../../hooks/useReports';

function StatRow({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <View style={styles.statRow}>
      <ThemedText variant="body" color="primary">{label}</ThemedText>
      <ThemedText variant="subtitle" color="primary" style={color ? { color } : undefined}>
        {value}
      </ThemedText>
    </View>
  );
}

export function SubscriptionReportScreen({ navigation }: { navigation: any }) {
  const { data: report } = useSubscriptionReport();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">{'< Back'}</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Subscriptions</ThemedText>
        <View style={{ width: 50 }} />
      </View>

      {/* Overview */}
      <View style={styles.overviewCard}>
        <ThemedText variant="title" color="primary">
          {report?.total ?? 0}
        </ThemedText>
        <ThemedText variant="small" color="subtitle">
          Total Subscriptions
        </ThemedText>
      </View>

      {/* Status Breakdown */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          Status
        </ThemedText>
        <StatRow label="Active" value={report?.active ?? 0} color={Theme.colors.status.success} />
        <StatRow label="Paused" value={report?.paused ?? 0} color={Theme.colors.status.warning} />
        <StatRow label="Cancelled" value={report?.cancelled ?? 0} color={Theme.colors.status.error} />
        <StatRow label="Total Skipped Days" value={report?.totalSkippedDays ?? 0} />
      </View>

      {/* Payment Method */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          By Payment Method
        </ThemedText>
        {Object.entries(report?.paymentBreakdown ?? {}).map(([method, count]) => (
          <StatRow key={method} label={method} value={count as number} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { padding: Theme.spacing.md, paddingTop: Theme.spacing.xl + Theme.spacing.md, paddingBottom: Theme.spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Theme.spacing.md },
  overviewCard: { backgroundColor: Theme.colors.background.secondary, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.lg, alignItems: 'center', marginBottom: Theme.spacing.md },
  section: { marginBottom: Theme.spacing.lg },
  sectionTitle: { marginBottom: Theme.spacing.sm },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: Theme.colors.layout.divider },
});
