/**
 * 1stOne F1 — Admin Orders Screen
 *
 * All orders for today (or selected date).
 * Filter by status/cycle, update status, cancel orders.
 * Realtime updates.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { useAdminOrders, useAdminUpdateOrder, useAdminCancelOrder } from '../../hooks/useAdminOrders';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import type { OrderStatus } from '../../types';

const STATUS_FILTERS: (OrderStatus | 'All')[] = [
  'All',
  'Confirmed',
  'Preparing',
  'Ready',
  'Packed',
  'Dispatched',
  'On the Way',
  'Delivered',
  'Cancelled',
];

const STATUS_FLOW: OrderStatus[] = [
  'Confirmed',
  'Preparing',
  'Ready',
  'Packed',
  'Dispatched',
  'On the Way',
  'Delivered',
];

function statusColor(status: OrderStatus): string {
  switch (status) {
    case 'Confirmed': return Theme.colors.status.info;
    case 'Preparing':
    case 'Ready': return Theme.colors.status.warning;
    case 'Packed':
    case 'Dispatched':
    case 'On the Way': return Theme.colors.action.primary;
    case 'Delivered': return Theme.colors.status.success;
    case 'Cancelled': return Theme.colors.status.error;
    default: return Theme.colors.text.muted;
  }
}

export function AdminOrdersScreen() {
  const navigation = useNavigation<any>();
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'All'>('All');
  const [cycleFilter, setCycleFilter] = useState<number | undefined>(undefined);

  const { data: cycles } = useDeliveryCycles();
  const { data: orders, isLoading, isError, refetch } = useAdminOrders({
    status: statusFilter === 'All' ? undefined : statusFilter,
    cycleId: cycleFilter,
  });

  const updateOrder = useAdminUpdateOrder();
  const cancelOrder = useAdminCancelOrder();

  useRealtimeOrders(true);

  const handleAdvanceStatus = useCallback(
    (orderId: number, currentStatus: OrderStatus) => {
      const idx = STATUS_FLOW.indexOf(currentStatus);
      if (idx === -1 || idx >= STATUS_FLOW.length - 1) return;
      const next = STATUS_FLOW[idx + 1];
      updateOrder.mutate({ orderId, status: next });
    },
    [updateOrder]
  );

  const handleCancel = useCallback(
    (orderId: number) => {
      Alert.alert('Cancel Order', `Cancel order #${orderId}?`, [
        { text: 'No', style: 'cancel' },
        {
          text: 'Cancel Order',
          style: 'destructive',
          onPress: () => cancelOrder.mutate({ orderId, reason: 'Cancelled by admin' }),
        },
      ]);
    },
    [cancelOrder]
  );

  const renderOrder = ({ item }: { item: any }) => {
    const customerName = item.profiles?.full_name || item.profiles?.phone_number || 'Unknown';
    const items = (item.order_items ?? [])
      .map((oi: any) => `${oi.item_name} x${oi.quantity}`)
      .join(', ');
    const canAdvance = STATUS_FLOW.indexOf(item.status) < STATUS_FLOW.length - 1
      && item.status !== 'Cancelled';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <ThemedText variant="subtitle" color="primary">
            #{item.id}
          </ThemedText>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) }]}>
            <ThemedText variant="micro" color="primary">
              {item.status}
            </ThemedText>
          </View>
        </View>

        <ThemedText variant="body" color="primary">
          {customerName}
        </ThemedText>
        <ThemedText variant="small" color="subtitle" style={styles.items}>
          {items || 'No items'}
        </ThemedText>

        <View style={styles.cardFooter}>
          <ThemedText variant="subtitle" color="primary">
            {'\u20B9'}{item.total_amount}
          </ThemedText>

          <View style={styles.actions}>
            {canAdvance && (
              <TouchableOpacity
                style={styles.advanceBtn}
                onPress={() => handleAdvanceStatus(item.id, item.status)}
              >
                <ThemedText variant="small" color="primary">
                  Next Status
                </ThemedText>
              </TouchableOpacity>
            )}

            {item.status !== 'Cancelled' && item.status !== 'Delivered' && (
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => handleCancel(item.id)}
              >
                <ThemedText variant="small" color="primary">
                  Cancel
                </ThemedText>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.headerTitle}>
          All Orders
        </ThemedText>
        <ThemedText variant="small" color="subtitle" style={styles.orderCount}>
          {(orders ?? []).length} today
        </ThemedText>
      </View>

      {/* Status Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
      >
        {STATUS_FILTERS.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
            onPress={() => setStatusFilter(s)}
          >
            <ThemedText
              variant="small"
              color={statusFilter === s ? 'primary' : 'subtitle'}
            >
              {s}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Cycle Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
      >
        <TouchableOpacity
          style={[styles.filterChip, !cycleFilter && styles.filterChipActive]}
          onPress={() => setCycleFilter(undefined)}
        >
          <ThemedText
            variant="small"
            color={!cycleFilter ? 'primary' : 'subtitle'}
          >
            All Cycles
          </ThemedText>
        </TouchableOpacity>
        {(cycles ?? []).map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.filterChip, cycleFilter === c.id && styles.filterChipActive]}
            onPress={() => setCycleFilter(c.id)}
          >
            <ThemedText
              variant="small"
              color={cycleFilter === c.id ? 'primary' : 'subtitle'}
            >
              {c.cycle_name}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Orders List */}
      {isError ? (
        <ErrorRetry message="Failed to load orders" onRetry={refetch} />
      ) : (
        <FlatList
          data={orders ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderOrder}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={Theme.colors.action.primary}
            />
          }
          ListEmptyComponent={
            !isLoading ? <EmptyState title="No orders match filters" /> : null
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  back: { minWidth: 60 },
  headerTitle: { flex: 1, textAlign: 'center' },
  orderCount: { minWidth: 60, textAlign: 'right' },
  filterBar: {
    maxHeight: 40,
  },
  filterBarContent: {
    paddingHorizontal: Theme.spacing.md,
    gap: Theme.spacing.xs,
  },
  filterChip: {
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.tertiary,
  },
  filterChipActive: {
    backgroundColor: Theme.colors.action.primary,
  },
  list: {
    padding: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },
  card: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
  },
  items: {
    marginBottom: Theme.spacing.sm,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Theme.colors.layout.divider,
    paddingTop: Theme.spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: Theme.spacing.xs,
  },
  advanceBtn: {
    backgroundColor: Theme.colors.action.primary,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 6,
  },
  cancelBtn: {
    backgroundColor: Theme.colors.status.error,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 6,
  },
});
