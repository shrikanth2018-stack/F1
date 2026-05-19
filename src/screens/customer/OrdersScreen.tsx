/**
 * 1stOne F1 — Customer Orders Screen
 * Food and Essentials orders in separate tabs.
 * Infinite scroll — 20 orders per page, more loaded on reaching list bottom.
 *
 * MF-10: a customer "order" can span multiple delivery cycles — each
 * cycle is its own `orders` row sharing one order_group_id. Rows are
 * grouped here so the customer sees ONE card per checkout, with a single
 * rolled-up status; the per-cycle breakdown lives in OrderDetail.
 */

import React, { useState, useCallback, useMemo } from 'react';
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
import { SegmentedControl } from '../../components/SegmentedControl';
import { useMyOrders } from '../../hooks/useOrders';
import { formatPriceShort, formatDateShort, formatRelativeTime } from '../../utils/formatters';
import { ORDER_STATUS_FLOW, orderStatusVariant } from '../../utils/orderStatus';
import type { Order } from '../../types';

type OrderTab = 'food' | 'essentials';

// ── Order-group model ─────────────────────────────────────────
// One checkout = one order_group_id = one or more `orders` rows.

interface OrderGroup {
  key: string;
  primaryId: number;       // lowest row id — the customer-facing order number
  rows: Order[];           // sorted by dispatch_date asc
  totalAmount: number;     // sum across the group (per-row money model)
  createdAt: string;
}

function groupOrders(orders: Order[]): OrderGroup[] {
  const map = new Map<string, Order[]>();
  for (const o of orders) {
    const key = o.order_group_id ?? `single-${o.id}`;
    const list = map.get(key) ?? [];
    list.push(o);
    map.set(key, list);
  }

  const groups: OrderGroup[] = [];
  map.forEach((rows) => {
    const sorted = [...rows].sort((a, b) =>
      a.dispatch_date < b.dispatch_date ? -1
        : a.dispatch_date > b.dispatch_date ? 1
        : a.id - b.id,
    );
    groups.push({
      key: sorted[0].order_group_id ?? `single-${sorted[0].id}`,
      primaryId: Math.min(...rows.map((r) => r.id)),
      rows: sorted,
      totalAmount: rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0),
      createdAt: sorted[0].created_at,
    });
  });

  // Most recent checkout first.
  groups.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return groups;
}

// A multi-cycle order has a status per cycle. The list card shows ONE
// rolled-up status: the least-advanced of the still-active rows, so the
// customer sees the slowest part. All rows cancelled → Cancelled.
function rolledUpStatus(rows: Order[]): string {
  const active = rows.filter((r) => r.status !== 'Cancelled');
  if (active.length === 0) return 'Cancelled';
  return active.reduce((least, r) => {
    const li = ORDER_STATUS_FLOW.indexOf(least as typeof ORDER_STATUS_FLOW[number]);
    const ri = ORDER_STATUS_FLOW.indexOf(r.status as typeof ORDER_STATUS_FLOW[number]);
    return ri !== -1 && (li === -1 || ri < li) ? r.status : least;
  }, active[0].status);
}

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

  // Memoised so groupOrders() only re-runs when the fetched data or the tab
  // changes — not on every render. Placed before the early return below to
  // keep hook order stable (Rules of Hooks).
  const groups = useMemo(() => {
    const allOrders: Order[] = data?.pages.flat() ?? [];
    const filtered = allOrders.filter((o) =>
      activeTab === 'food' ? o.order_type === 'food' : o.order_type === 'essential',
    );
    return groupOrders(filtered);
  }, [data, activeTab]);

  if (error) {
    return <ErrorRetry message="Could not load orders" onRetry={refetch} />;
  }

  const renderGroup = ({ item }: { item: OrderGroup }) => {
    const isMulti = item.rows.length > 1;
    const status = rolledUpStatus(item.rows);
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.primaryId })}
      >
        <View style={styles.rowTop}>
          <ThemedText variant="subtitle" color="primary">Order #{item.primaryId}</ThemedText>
          <DispatchBadge label={status} variant={orderStatusVariant(status)} />
        </View>

        <View style={styles.rowMid}>
          <ThemedText variant="body" color="subtitle">
            {isMulti
              ? `${item.rows.length} deliveries · ${formatPriceShort(item.totalAmount)}`
              : `${formatDateShort(item.rows[0].dispatch_date)} · ${formatPriceShort(item.totalAmount)}`}
          </ThemedText>
          <ThemedText variant="small" color="muted">
            {formatRelativeTime(item.createdAt)}
          </ThemedText>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ThemedText variant="header" color="primary">My Orders</ThemedText>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="muted">Close</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Food | Essentials — shared glass pill (D24) */}
      <SegmentedControl
        style={styles.tabs}
        value={activeTab}
        onChange={setActiveTab}
        options={[
          { key: 'food', label: 'Food' },
          { key: 'essentials', label: 'Essentials' },
        ]}
      />

      <FlatList
        data={groups}
        keyExtractor={(item) => item.key}
        renderItem={renderGroup}
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
              subtitle="Browse plans or order a single meal to get started"
              actionLabel="Browse Plans"
              onAction={() => navigation.navigate('Plans')}
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
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
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
