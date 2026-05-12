/**
 * 1stOne F1 — Hub Manager Dashboard
 *
 * Customer-role users whose profile has assigned_hub_id set unlock this screen
 * from the Profile popup.
 *
 * Two tabs:
 *   - Today    — active orders routed to this hub. Status advance flow:
 *                Dispatched      → Received at Hub
 *                Received at Hub → On the Way
 *                On the Way      → Delivered
 *   - History  — last 100 orders for this hub, all statuses, read-only.
 *
 * Per-row actions (call customer, open in maps with directions, view address)
 * are provided by the shared DeliveryOrderRow component on both tabs.
 * History rows render with readOnly=true → status pill is non-tappable.
 */

import React, { useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { DeliveryOrderRow } from '../../components/DeliveryOrderRow';
import { useStaffOrders, useUpdateOrderStatus } from '../../hooks/useStaffOrders';
import { useHubOrderHistory } from '../../hooks/useHubOrderHistory';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useStaffNoteForTab } from '../../hooks/useAdminNotes';
import { formatDateShort, formatPriceShort } from '../../utils/formatters';
import type { CustomerScreenProps } from '../../navigation/types';
import type { OrderStatus } from '../../types';

type HubTab = 'Today' | 'History';
const TABS: HubTab[] = ['Today', 'History'];

export function HubDashboardScreen({ navigation }: CustomerScreenProps<'HubDashboard'>) {
  const [tab, setTab] = useState<HubTab>('Today');

  // Today data (live, with realtime invalidation)
  const today = useStaffOrders();
  const { mutateAsync: updateStatus, isPending: isUpdating } = useUpdateOrderStatus();
  // Hub-specific + broadcast notes from admin
  const { data: notes = [] } = useStaffNoteForTab('hub');
  // Realtime invalidates Today's cache so freshly-dispatched orders appear
  // without pull-to-refresh. History is intentionally not realtime — pull-to-refresh re-fetches.
  useRealtimeOrders(true);

  // History data (lazy — query is enabled by the hook unconditionally, but
  // FlatList only mounts when the History tab is active, so the network
  // request fires once the user taps over).
  const history = useHubOrderHistory();

  const handleAdvanceStatus = async (
    orderId: number,
    next: OrderStatus,
    customerUserId: string | null,
  ) => {
    try {
      await updateStatus({ orderId, status: next, userId: customerUserId ?? undefined });
    } catch (e: any) {
      Alert.alert('Could not update status', e?.message ?? 'Please try again.');
    }
  };

  const isToday = tab === 'Today';
  const data = isToday ? (today.data ?? []) : (history.data ?? []);
  const isLoading = isToday ? today.isLoading : history.isLoading;
  const isRefetching = isToday ? today.isRefetching : history.isRefetching;
  const refetch = isToday ? today.refetch : history.refetch;
  const error = isToday ? today.error : history.error;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="accent">‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">My Hub</ThemedText>
        <View style={styles.spacer} />
      </View>

      {/* Tab strip — pipe-separated, matches StaffDashboard pattern */}
      <View style={styles.tabRow}>
        {TABS.map((t, i) => (
          <React.Fragment key={t}>
            <TouchableOpacity onPress={() => setTab(t)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <ThemedText
                variant="body"
                color={tab === t ? 'primary' : 'muted'}
                style={tab === t ? styles.tabActive : styles.tabInactive}
              >
                {t}
              </ThemedText>
            </TouchableOpacity>
            {i < TABS.length - 1 && (
              <ThemedText variant="body" color="muted" style={styles.tabSep}>|</ThemedText>
            )}
          </React.Fragment>
        ))}
      </View>

      {/* Admin notes — hub-specific + broadcasts. Single-line, centered, mild yellow. */}
      {isToday && notes.map((n) => (
        <Text key={n.id} style={styles.noteLine} numberOfLines={1}>{n.note_text}</Text>
      ))}

      {error ? (
        <ErrorRetry message={isToday ? 'Failed to load hub orders' : 'Failed to load history'} onRetry={refetch} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(o: any) => String(o.id)}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Theme.colors.text.mint} />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            !isLoading ? (
              <EmptyState title={isToday ? 'No orders for your hub today' : 'No history yet'} />
            ) : null
          }
          ItemSeparatorComponent={() => <Divider />}
          renderItem={({ item }) =>
            isToday ? (
              <DeliveryOrderRow
                order={item}
                onAdvanceStatus={handleAdvanceStatus}
                isUpdating={isUpdating}
                persona="hub_operator"
              />
            ) : (
              <HistoryRow
                order={item}
                onPress={() => navigation.navigate('HubOrderHistoryDetail', { orderId: item.id })}
              />
            )
          }
        />
      )}

      {isLoading && data.length === 0 && (
        <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
      )}
    </SafeAreaView>
  );
}

// ── History row — minimal display, tap to drill into HubOrderHistoryDetail ──
function HistoryRow({ order, onPress }: { order: any; onPress: () => void }) {
  const itemsSummary = (order.order_items ?? [])
    .map((oi: any) => `${oi.item_name} ×${oi.quantity}`)
    .join(', ') || '—';
  return (
    <TouchableOpacity style={styles.histRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.histTop}>
        <ThemedText variant="subtitle" color="primary">Order #{order.id}</ThemedText>
        <ThemedText variant="body" color="subtitle">{formatPriceShort(order.total_amount)}</ThemedText>
      </View>
      <ThemedText variant="small" color="muted" style={styles.histSub}>
        {order.dispatch_date ? formatDateShort(order.dispatch_date) : '—'}
      </ThemedText>
      <ThemedText variant="small" color="subtitle" numberOfLines={2} style={styles.histSub}>
        {itemsSummary}
      </ThemedText>
    </TouchableOpacity>
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

  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  tabActive: {
    fontSize: Theme.typography.sizes.body + 4,
    fontWeight: '600',
  },
  tabInactive: {
    fontSize: Theme.typography.sizes.body + 4,
  },
  tabSep: {
    fontSize: Theme.typography.sizes.body + 4,
  },

  noteLine: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 3,
    color: Theme.colors.status.warning,
    textAlign: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs + 2,
  },
  list: { paddingVertical: Theme.spacing.sm },
  loader: { marginTop: Theme.spacing.xl },

  histRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  histTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  histSub: {
    marginTop: 2,
  },
});
