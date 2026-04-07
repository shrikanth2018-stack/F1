/**
 * 1stOne F1 — Customer Orders Screen
 * Shows order history with status badges. Tap to view detail.
 */

import React from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { DispatchBadge } from '../../components/DispatchBadge';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { useMyOrders } from '../../hooks/useOrders';
import { formatPriceShort, formatDateShort, formatRelativeTime } from '../../utils/formatters';
import type { Order, OrderStatus } from '../../types';

const statusVariant: Record<string, 'success' | 'warning' | 'info' | 'error'> = {
  Confirmed: 'info',
  Preparing: 'info',
  Ready: 'info',
  Packed: 'info',
  Dispatched: 'warning',
  'On the Way': 'warning',
  Delivered: 'success',
  'Received at Hub': 'info',
  Cancelled: 'error',
};

export function OrdersScreen({ navigation }: any) {
  const { data: orders, isLoading, error, refetch } = useMyOrders();

  if (error) {
    return <ErrorRetry message="Could not load orders" onRetry={refetch} />;
  }

  const renderOrder = ({ item }: { item: Order }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
    >
      <View style={styles.cardTop}>
        <ThemedText variant="body" color="primary">
          Order #{item.id}
        </ThemedText>
        <DispatchBadge
          label={item.status}
          variant={statusVariant[item.status] ?? 'info'}
        />
      </View>
      <View style={styles.cardBottom}>
        <ThemedText variant="small" color="subtitle">
          {formatDateShort(item.dispatch_date)} · {formatPriceShort(item.total_amount)}
        </ThemedText>
        <ThemedText variant="micro" color="muted">
          {formatRelativeTime(item.created_at)}
        </ThemedText>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ThemedText variant="header" color="primary">
          Orders
        </ThemedText>
      </View>

      <FlatList
        data={orders ?? []}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={Theme.colors.action.primary}
          />
        }
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              title="No orders yet"
              subtitle="Your order history will appear here"
            />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  list: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },
  card: {
    backgroundColor: Theme.colors.background.card,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
