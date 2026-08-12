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
import { useMyOrders, useMyOrderStates, type OrderWithItems } from '../../hooks/useOrders';
import { useBrowsePlans } from '../../hooks/useBrowsePlans';
import { formatPriceShort, formatDateShort, formatRelativeTime } from '../../utils/formatters';
import { orderStatusVariant } from '../../utils/orderStatus';
import {
  groupIntoDeliveries,
  rolledUpStatus,
  formatOrderNumbers,
  type Delivery,
} from '../../utils/orderDeliveries';


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

type OrderGroup = Delivery<OrderWithItems>;

// Grouping, the rolled-up status and the number formatting all live in
// src/utils/orderDeliveries.ts now — the home rail and the order detail page
// need the same three, and three copies of "what is one delivery" is how they
// come to disagree.
export function OrdersScreen({ navigation }: any) {
  const browsePlans = useBrowsePlans();
  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMyOrders();

  /**
   * Which of these were never delivered — server-decided, shared with the
   * admin Undelivered tab. See useMyOrderStates.
   *
   * The order STAYS in the history. It was paid for; hiding it would leave
   * the customer with no record of what they are owed and nothing to point at
   * when they ask. It simply stops claiming to be on its way.
   */
  const { data: orderStates, refetch: refetchStates } = useMyOrderStates();

  useFocusEffect(useCallback(() => {
    refetch();
    refetchStates();
  }, [refetch, refetchStates]));


  /**
   * ONE CARD PER DELIVERY. Group, never filter.
   *
   * This screen once filtered rows by type into Food and Essentials tabs,
   * which tore a single purchase in half and hid subscription purchases
   * entirely. Grouping replaced that — first by checkout, now by delivery.
   *
   * Memoised so the grouping only re-runs when the fetched data changes.
   * Placed before the early return below to keep hook order stable.
   */
  const groups = useMemo(
    () => groupIntoDeliveries(data?.pages.flat() ?? [], {
      // A 30-day plan would add thirty entries the customer never placed,
      // burying the orders they did. The plan's PURCHASE row stays — it is a
      // real purchase with a real amount — and the running plan is tracked
      // on the Plans rail.
      excludeSubscriptionDispatches: true,
    }),
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
    /**
     * "Undelivered" is a LABEL, not a status — nothing writes it to the row.
     * The order keeps the status it actually stalled at (Dispatched, Received
     * at Hub), which is what staff and admin need in order to chase it; the
     * customer is told the thing that matters to them, which is that it never
     * arrived.
     *
     * `some`, not `every`: a delivery is one cycle on one date at one door, so
     * its rows share a batch and are undelivered together. If that ever stops
     * being true, the honest answer for the bag is still "undelivered".
     */
    const undelivered = item.rows.some((r) => orderStates?.get(r.id) === 'undelivered');
    const status = undelivered ? 'Undelivered' : rolledUpStatus(item.rows);
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
          {/* EVERY number in the bag, not just the lowest. Each id is real
              — staff search by it and it is printed on the slip — so showing
              one left the customer unable to ask about the other half of
              their own delivery. */}
          <ThemedText variant="subtitle" color="primary" numberOfLines={1}>
            {item.ids.length > 1 ? 'Orders ' : 'Order '}{formatOrderNumbers(item.ids)}
          </ThemedText>
          <DispatchBadge
            label={status}
            // 'Undelivered' is not in the status vocabulary, so
            // orderStatusVariant would fall through to its 'info' default and
            // print it in the same colour as "Preparing".
            variant={undelivered ? 'error' : orderStatusVariant(status)}
          />
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
              onAction={browsePlans}
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
