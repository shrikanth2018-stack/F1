/**
 * 1stOne F1 — Driver Dashboard
 *
 * Deliveries assigned to this driver — identified by membership in
 * delivery_hubs.driver_user_id and/or delivery_zones.driver_user_id.
 *
 * Two tabs, the same shape the hub operator already has:
 *   Today   — the live board: exactly the pushed batch, rows staying until
 *             Delivered or until the next push replaces them.
 *   History — everything carried before, newest first, read-only. This is
 *             where an order goes when it falls off the live board
 *             unfinished; admin chases it from Orders → Undelivered.
 *
 * Per-row actions on Today: status advance (Dispatched → Received at Hub if
 * a hub order → On the Way → Delivered), call customer, open in maps with
 * directions, show full address. History rows are readOnly.
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Text,
} from 'react-native';
import { getErrorMessage, formatDateShort } from '../../utils/formatters';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { DeliveryOrderRow } from '../../components/DeliveryOrderRow';
import { SegmentedControl } from '../../components/SegmentedControl';
import { useUpdateOrderStatus } from '../../hooks/useStaffOrders';
import { useDriverOrders, useDriverOrderHistory } from '../../hooks/useDriverOrders';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useStaffNoteForTab } from '../../hooks/useAdminNotes';
import type { CustomerScreenProps } from '../../navigation/types';
import type { OrderStatus } from '../../types';

type DriverTab = 'Today' | 'History';

export function DriverDashboardScreen({ navigation }: CustomerScreenProps<'DriverDashboard'>) {
  const [tab, setTab] = useState<DriverTab>('Today');

  const { mutateAsync: updateStatus, isPending: isUpdating } = useUpdateOrderStatus();
  // Realtime: refresh when an order is dispatched / advances through hub handoff.
  // Also keeps the admin-note banner below in sync — useRealtimeOrders
  // invalidates the staff_notes query on any admin_notes change.
  useRealtimeOrders(true);
  // Delivery-tab + All-Staff broadcast banner. Same shape as Hub.
  const { data: notes = [] } = useStaffNoteForTab('delivery');

  const live = useDriverOrders();
  const history = useDriverOrderHistory();

  const isToday = tab === 'Today';
  const orders = (isToday ? live.data : history.data) ?? [];
  const isLoading = isToday ? live.isLoading : history.isLoading;
  const isRefetching = isToday ? live.isRefetching : history.isRefetching;
  const refetch = isToday ? live.refetch : history.refetch;
  const error = isToday ? live.error : history.error;

  const handleAdvanceStatus = async (
    orderId: number,
    next: OrderStatus,
    customerUserId: string | null,
  ) => {
    try {
      await updateStatus({ orderId, status: next, userId: customerUserId ?? undefined });
    } catch (e) {
      Alert.alert('Could not update status', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="accent">‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">My Deliveries</ThemedText>
        <View style={styles.spacer} />
      </View>

      {/* Admin notes — delivery-specific + broadcasts. Single-line, centered,
          mild yellow. Same pattern as HubDashboard / StaffDashboard. */}
      {notes.map((n: any) => (
        <Text key={n.id} style={styles.noteLine} numberOfLines={1}>{n.note_text}</Text>
      ))}

      {/* Today | History — the same two-tab shape the hub operator has, for
          the same reason: the live board is one batch, and everything that
          has already been through it still has to be lookupable. */}
      <SegmentedControl
        style={styles.tabs}
        value={tab}
        onChange={setTab}
        options={[
          { key: 'Today', label: 'Today' },
          { key: 'History', label: 'History' },
        ]}
      />

      {error ? (
        <ErrorRetry message="Failed to load deliveries" onRetry={refetch} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o: any) => String(o.id)}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Theme.colors.text.mint} />
          }
          ItemSeparatorComponent={() => <Divider />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            !isLoading ? (
              isToday ? (
                <EmptyState
                  title="Nothing to deliver yet"
                  subtitle="Orders appear here the moment the kitchen releases the next batch."
                />
              ) : (
                <EmptyState title="No past deliveries" subtitle="Completed runs will be listed here." />
              )
            ) : null
          }
          renderItem={({ item }) =>
            isToday ? (
              <DeliveryOrderRow
                order={item}
                onAdvanceStatus={handleAdvanceStatus}
                isUpdating={isUpdating}
                persona="driver"
              />
            ) : (
              <DriverHistoryRow order={item} />
            )
          }
        />
      )}

      {isLoading && orders.length === 0 && (
        <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
      )}
    </SafeAreaView>
  );
}

/**
 * A past delivery — read-only.
 *
 * No status pill: History exists precisely for rows the driver can no longer
 * act on, and a tappable pill on one of them would offer an action the board
 * rule has already taken away. An order that ended anywhere other than
 * Delivered says so, because that is the row admin is chasing.
 */
function DriverHistoryRow({ order }: { order: any }) {
  const items = (order.order_items ?? [])
    .map((oi: any) => `${oi.item_name} ×${oi.quantity}`)
    .join(', ') || '—';
  const delivered = order.status === 'Delivered';
  return (
    <View style={styles.histRow}>
      <View style={styles.histTop}>
        <ThemedText variant="subtitle" color="primary">Order #{order.id}</ThemedText>
        <ThemedText variant="small" color={delivered ? 'muted' : 'warning'}>
          {order.status}
        </ThemedText>
      </View>
      <ThemedText variant="small" color="muted">
        {order.dispatch_date ? formatDateShort(order.dispatch_date) : '—'}
      </ThemedText>
      <ThemedText variant="small" color="subtitle" numberOfLines={2}>
        {items}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  spacer: { minWidth: 60 },
  tabs: {
    marginHorizontal: Theme.spacing.md,
    marginVertical: Theme.spacing.sm,
  },
  histRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    gap: 2,
  },
  histTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  list: { paddingBottom: Theme.spacing.xl },
  loader: { marginTop: Theme.spacing.xl },
  noteLine: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 3,
    color: Theme.colors.status.warning,
    textAlign: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs + 2,
  },
});
