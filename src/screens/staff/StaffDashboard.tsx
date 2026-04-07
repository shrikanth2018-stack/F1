/**
 * 1stOne F1 — Staff Dashboard
 *
 * Today's delivery orders grouped by cycle.
 * Cycle filter tabs → order cards → status update buttons.
 * Mark individual or batch-delivered.
 * Realtime updates via Supabase channel.
 * Offline banner + pending queue count.
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
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import {
  useStaffOrders,
  useUpdateOrderStatus,
  useBatchMarkDelivered,
} from '../../hooks/useStaffOrders';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import type { OrderStatus } from '../../types';

const STATUS_FLOW: OrderStatus[] = [
  'Confirmed',
  'Preparing',
  'Ready',
  'Packed',
  'Dispatched',
  'On the Way',
  'Delivered',
];

function getNextStatus(current: OrderStatus): OrderStatus | null {
  const idx = STATUS_FLOW.indexOf(current);
  if (idx === -1 || idx >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[idx + 1];
}

function statusColor(status: OrderStatus): string {
  switch (status) {
    case 'Confirmed':
      return Theme.colors.status.info;
    case 'Preparing':
    case 'Ready':
      return Theme.colors.status.warning;
    case 'Packed':
    case 'Dispatched':
    case 'On the Way':
      return Theme.colors.action.primary;
    case 'Delivered':
      return Theme.colors.status.success;
    case 'Received at Hub':
      return Theme.colors.status.success;
    case 'Cancelled':
      return Theme.colors.status.error;
    default:
      return Theme.colors.text.muted;
  }
}

export function StaffDashboard() {
  const [activeCycleId, setActiveCycleId] = useState<number | undefined>(undefined);
  const { data: cycles } = useDeliveryCycles();
  const { data: orders, isLoading, isError, refetch } = useStaffOrders(activeCycleId);
  const updateStatus = useUpdateOrderStatus();
  const batchDeliver = useBatchMarkDelivered();
  const { pendingCount } = useOfflineSync();

  // Enable realtime for staff
  useRealtimeOrders(true);

  const pendingOrders = (orders ?? []).filter((o) => o.status !== 'Delivered' && o.status !== 'Cancelled');
  const deliveredOrders = (orders ?? []).filter((o) => o.status === 'Delivered');

  const handleStatusUpdate = useCallback(
    (orderId: number, nextStatus: OrderStatus) => {
      updateStatus.mutate({ orderId, status: nextStatus });
    },
    [updateStatus]
  );

  const handleBatchDeliver = useCallback(() => {
    const readyIds = pendingOrders
      .filter((o) => o.status === 'On the Way' || o.status === 'Dispatched')
      .map((o) => o.id);

    if (readyIds.length === 0) {
      Alert.alert('No orders ready', 'Only Dispatched or On the Way orders can be batch-delivered.');
      return;
    }

    Alert.alert(
      'Batch Deliver',
      `Mark ${readyIds.length} order(s) as Delivered?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deliver All',
          onPress: () => batchDeliver.mutate(readyIds),
        },
      ]
    );
  }, [pendingOrders, batchDeliver]);

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const renderOrder = ({ item }: { item: any }) => {
    const nextStatus = getNextStatus(item.status);
    const address = item.customer_addresses;
    const itemNames = (item.order_items ?? [])
      .map((oi: any) => `${oi.item_name} x${oi.quantity}`)
      .join(', ');

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

        <ThemedText variant="small" color="subtitle" style={styles.items}>
          {itemNames || 'No items'}
        </ThemedText>

        {address && (
          <ThemedText variant="small" color="muted" style={styles.address}>
            {address.full_name} — {address.address_line}
            {address.landmark ? `, ${address.landmark}` : ''}
          </ThemedText>
        )}

        <View style={styles.cardFooter}>
          <ThemedText variant="small" color="subtitle">
            {'\u20B9'}{item.total_amount}
          </ThemedText>

          {nextStatus && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleStatusUpdate(item.id, nextStatus)}
              disabled={updateStatus.isPending}
            >
              <ThemedText variant="small" color="primary">
                {nextStatus === 'Delivered' ? 'Mark Delivered' : `→ ${nextStatus}`}
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <ThemedText variant="header" color="primary">
            Deliveries
          </ThemedText>
          <ThemedText variant="small" color="subtitle">
            {dateStr}
          </ThemedText>
        </View>
        {pendingCount > 0 && (
          <View style={styles.queueBadge}>
            <ThemedText variant="micro" color="primary">
              {pendingCount} queued
            </ThemedText>
          </View>
        )}
      </View>

      {/* Cycle Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.cycleBar}
        contentContainerStyle={styles.cycleBarContent}
      >
        <TouchableOpacity
          style={[styles.cycleTab, !activeCycleId && styles.cycleTabActive]}
          onPress={() => setActiveCycleId(undefined)}
        >
          <ThemedText
            variant="small"
            color={!activeCycleId ? 'primary' : 'subtitle'}
          >
            All
          </ThemedText>
        </TouchableOpacity>

        {(cycles ?? []).map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.cycleTab, activeCycleId === c.id && styles.cycleTabActive]}
            onPress={() => setActiveCycleId(c.id)}
          >
            <ThemedText
              variant="small"
              color={activeCycleId === c.id ? 'primary' : 'subtitle'}
            >
              {c.cycle_name}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <ThemedText variant="small" color="subtitle">
          Pending: {pendingOrders.length}
        </ThemedText>
        <ThemedText variant="small" color="subtitle">
          Delivered: {deliveredOrders.length}
        </ThemedText>
        {pendingOrders.length > 0 && (
          <TouchableOpacity onPress={handleBatchDeliver}>
            <ThemedText variant="small" color="accent">
              Batch Deliver
            </ThemedText>
          </TouchableOpacity>
        )}
      </View>

      {/* Orders List */}
      {isError ? (
        <ErrorRetry message="Failed to load orders" onRetry={refetch} />
      ) : (
        <FlatList
          data={[...pendingOrders, ...deliveredOrders]}
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
            !isLoading ? (
              <EmptyState message="No orders for today yet" />
            ) : null
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.xl + Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  queueBadge: {
    backgroundColor: Theme.colors.status.warning,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderRadius: Theme.components.inputRadius,
  },
  cycleBar: {
    maxHeight: 44,
  },
  cycleBarContent: {
    paddingHorizontal: Theme.spacing.md,
    gap: Theme.spacing.sm,
  },
  cycleTab: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderRadius: Theme.components.inputRadius,
    backgroundColor: Theme.colors.background.tertiary,
  },
  cycleTabActive: {
    backgroundColor: Theme.colors.action.primary,
  },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.layout.divider,
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
    marginBottom: Theme.spacing.xs,
  },
  address: {
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
  actionBtn: {
    backgroundColor: Theme.colors.action.primary,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 8,
  },
});
