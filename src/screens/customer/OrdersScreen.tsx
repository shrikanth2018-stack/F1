/**
 * 1stOne F1 — Customer Orders Screen
 * Food and Essentials orders in separate tabs.
 * Infinite scroll — 20 orders per page, more loaded on reaching list bottom.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { DispatchBadge } from '../../components/DispatchBadge';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { useMyOrders } from '../../hooks/useOrders';
import { formatPriceShort, formatDateShort, formatRelativeTime } from '../../utils/formatters';
import type { Order } from '../../types';

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

type OrderTab = 'food' | 'essentials';

export function OrdersScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState<OrderTab>('food');
  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMyOrders();

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  if (error) {
    return <ErrorRetry message="Could not load orders" onRetry={refetch} />;
  }

  const allOrders: Order[] = data?.pages.flat() ?? [];
  const filtered = allOrders.filter((o) =>
    activeTab === 'food' ? o.order_type === 'food' : o.order_type === 'essential'
  );

  const renderOrder = ({ item }: { item: Order }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
    >
      <View style={styles.rowTop}>
        <ThemedText variant="subtitle" color="primary">Order #{item.id}</ThemedText>
        <DispatchBadge
          label={item.status}
          variant={statusVariant[item.status] ?? 'info'}
        />
      </View>
      <View style={styles.rowMid}>
        <ThemedText variant="body" color="subtitle">
          {formatDateShort(item.dispatch_date)} · {formatPriceShort(item.total_amount)}
        </ThemedText>
        <ThemedText variant="small" color="muted">
          {formatRelativeTime(item.created_at)}
        </ThemedText>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ThemedText variant="header" color="primary">My Orders</ThemedText>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="muted">Close</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'food' && styles.tabActive]}
          onPress={() => setActiveTab('food')}
        >
          <ThemedText
            variant="body"
            color={activeTab === 'food' ? 'primary' : 'muted'}
            style={activeTab === 'food' ? styles.tabTextActive : undefined}
          >
            Food
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'essentials' && styles.tabActive]}
          onPress={() => setActiveTab('essentials')}
        >
          <ThemedText
            variant="body"
            color={activeTab === 'essentials' ? 'primary' : 'muted'}
            style={activeTab === 'essentials' ? styles.tabTextActive : undefined}
          >
            Essentials
          </ThemedText>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && !isFetchingNextPage}
            onRefresh={refetch}
            tintColor={Theme.colors.action.primary}
          />
        }
        onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          isFetchingNextPage
            ? <ActivityIndicator color={Theme.colors.action.primary} style={styles.footer} />
            : null
        }
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              title={`No ${activeTab} orders yet`}
              subtitle="Your order history will appear here"
            />
          ) : null
        }
      />
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
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {},
  tabTextActive: {},
  list: {
    paddingTop: Theme.spacing.xs,
    paddingBottom: Theme.spacing.xl,
  },
  row: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  rowMid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  footer: {
    paddingVertical: Theme.spacing.md,
  },
});
