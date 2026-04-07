/**
 * 1stOne F1 — Admin Dashboard
 *
 * Business overview: today's stats cards, recent order activity.
 * Realtime order updates. Pull-to-refresh.
 */

import React from 'react';
import { View, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ErrorRetry } from '../../components/ErrorRetry';
import { useAdminStats } from '../../hooks/useAdminStats';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <View style={styles.statCard}>
      <ThemedText variant="small" color="subtitle">
        {label}
      </ThemedText>
      <ThemedText
        variant="title"
        color="primary"
        style={color ? { color } : undefined}
      >
        {value}
      </ThemedText>
    </View>
  );
}

export function AdminDashboard() {
  const { data: stats, isLoading, isError, refetch } = useAdminStats();

  // Enable realtime for admin
  useRealtimeOrders(true);

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  if (isError) {
    return <ErrorRetry message="Failed to load dashboard" onRetry={refetch} />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={refetch}
          tintColor={Theme.colors.action.primary}
        />
      }
    >
      <ThemedText variant="header" color="primary">
        Dashboard
      </ThemedText>
      <ThemedText variant="small" color="subtitle" style={styles.date}>
        {today}
      </ThemedText>

      {/* Revenue Card (full width) */}
      <View style={styles.revenueCard}>
        <ThemedText variant="small" color="subtitle">
          Today's Revenue
        </ThemedText>
        <ThemedText variant="title" color="primary" style={styles.revenueAmount}>
          {'\u20B9'}{(stats?.todayRevenue ?? 0).toLocaleString('en-IN')}
        </ThemedText>
        <ThemedText variant="small" color="muted">
          from {stats?.todayOrders ?? 0} orders
        </ThemedText>
      </View>

      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        <StatCard
          label="Pending"
          value={stats?.pendingOrders ?? 0}
          color={Theme.colors.status.warning}
        />
        <StatCard
          label="Delivered"
          value={stats?.deliveredOrders ?? 0}
          color={Theme.colors.status.success}
        />
        <StatCard
          label="Active Subs"
          value={stats?.activeSubscriptions ?? 0}
          color={Theme.colors.action.primary}
        />
        <StatCard
          label="Staff"
          value={stats?.totalStaff ?? 0}
        />
      </View>

      {/* Pending Actions */}
      {(stats?.pendingExpenses ?? 0) > 0 && (
        <View style={styles.alertCard}>
          <ThemedText variant="body" color="primary">
            {stats?.pendingExpenses} expense claim(s) awaiting approval
          </ThemedText>
        </View>
      )}
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
  date: {
    marginTop: Theme.spacing.xs,
    marginBottom: Theme.spacing.lg,
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
  },
  statCard: {
    width: '48%',
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    alignItems: 'center',
    flexGrow: 1,
  },
  alertCard: {
    backgroundColor: Theme.colors.background.tertiary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Theme.colors.status.warning,
  },
});
