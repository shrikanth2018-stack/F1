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

import React, { useCallback, useMemo } from 'react';
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
import { useMyOrders, type OrderWithItems } from '../../hooks/useOrders';
import { formatPriceShort, formatDateShort, formatRelativeTime } from '../../utils/formatters';
import { ORDER_STATUS_FLOW, orderStatusVariant } from '../../utils/orderStatus';


// ── Delivery model ────────────────────────────────────────────
//
// A CARD IS ONE DELIVERY, NOT ONE CHECKOUT.
//
// "Order" means two things: to a customer it is one basket and one payment;
// to the kitchen, the packers, the driver and the hub it is one BAG going out
// in one window. One checkout usually becomes several bags — breakfast
// tomorrow and dinner tonight, or food and milk in the same morning, because
// one is cooked and one comes off a shelf.
//
// Grouping by checkout made the customer track something nobody else could
// look up: one card, one number, while the second bag's number was real, in
// use by staff, and printed on the slip. Grouping by DELIVERY makes the row
// the customer watches the same object that arrives at their door.
//
// Same window + same day = one card, contents combined, one status tracker.
// A different window is a different card.

interface OrderGroup {
  key: string;
  primaryId: number;       // lowest row id in this delivery
  rows: OrderWithItems[];  // the rows making up this one delivery
  totalAmount: number;     // sum across the delivery
  createdAt: string;
}

function groupOrders(orders: OrderWithItems[]): OrderGroup[] {
  const map = new Map<string, OrderWithItems[]>();
  for (const o of orders) {
    // DAILY SUBSCRIPTION DELIVERIES ARE NOT LISTED HERE. A 30-day plan would
    // add thirty entries the customer never placed, burying the orders they
    // did. The plan's own purchase entry stays (it is a real purchase with a
    // real amount), and the running plan is tracked on the Plans rail.
    if (o.subscription_id != null) continue;

    // One key per DELIVERY: same purchase, same window, same day. A plan
    // purchase has no window, so it stands alone under its own id.
    const key = o.cycle_id == null
      ? `purchase-${o.id}`
      : `${o.order_group_id ?? `single-${o.id}`}:${o.cycle_id}:${o.dispatch_date}`;
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
function rolledUpStatus(rows: OrderWithItems[]): string {
  const active = rows.filter((r) => r.status !== 'Cancelled');
  if (active.length === 0) return 'Cancelled';
  return active.reduce((least, r) => {
    const li = ORDER_STATUS_FLOW.indexOf(least as typeof ORDER_STATUS_FLOW[number]);
    const ri = ORDER_STATUS_FLOW.indexOf(r.status as typeof ORDER_STATUS_FLOW[number]);
    return ri !== -1 && (li === -1 || ri < li) ? r.status : least;
  }, active[0].status);
}

export function OrdersScreen({ navigation }: any) {
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


  /**
   * ONE CARD PER DELIVERY. Group, never filter.
   *
   * This screen once filtered rows by type into Food and Essentials tabs,
   * which tore a single purchase in half and hid subscription purchases
   * entirely. Grouping replaced that — first by checkout, now by delivery.
   *
   * Memoised so groupOrders() only re-runs when the fetched data changes.
   * Placed before the early return below to keep hook order stable.
   */
  const groups = useMemo(
    () => groupOrders(data?.pages.flat() ?? []),
    [data],
  );

  if (error) {
    return <ErrorRetry message="Could not load orders" onRetry={refetch} />;
  }

  const renderGroup = ({ item }: { item: OrderGroup }) => {
    /**
     * Every card is now ONE delivery, so there is no delivery count to show —
     * just when it arrives, what is in it, and one status for the lot.
     *
     * The status is the LEAST advanced row in the delivery. A morning bag of
     * idli and milk is two rows on different journeys — the food is cooked,
     * the milk is not — and the customer is waiting for the whole bag, so the
     * tracker follows the slower half.
     */
    const isPurchaseOnly = item.rows.every((r) => r.cycle_id == null);
    const status = rolledUpStatus(item.rows);
    const contents = item.rows
      .flatMap((r) => r.order_items ?? [])
      .map((i) => i.item_name)
      .join(', ');

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
            {isPurchaseOnly
              ? `Subscription · ${formatPriceShort(item.totalAmount)}`
              : `${formatDateShort(item.rows[0].dispatch_date)} · ${formatPriceShort(item.totalAmount)}`}
          </ThemedText>
          <ThemedText variant="small" color="muted">
            {formatRelativeTime(item.createdAt)}
          </ThemedText>
        </View>

        {/* What is actually in the bag — the customer should not have to open
            the order to know which delivery this card is. */}
        {!!contents && (
          <ThemedText variant="small" color="muted" numberOfLines={2} style={styles.contents}>
            {contents}
          </ThemedText>
        )}

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
              title="No orders yet"
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
  contents: { marginTop: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
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
