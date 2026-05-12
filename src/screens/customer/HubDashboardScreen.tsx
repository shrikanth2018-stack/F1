/**
 * 1stOne F1 — Hub Manager Dashboard
 *
 * Customer-role users whose profile has assigned_hub_id set unlock this screen
 * from the Profile popup. Shows today's orders routed to their hub. Status
 * advance flow (handled by DeliveryOrderRow):
 *   Dispatched      → Received at Hub
 *   Received at Hub → On the Way
 *   On the Way      → Delivered
 *
 * Per-row actions (call customer, open in maps with directions, view address)
 * are provided by the shared DeliveryOrderRow component.
 */

import React from 'react';
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
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useStaffNoteForTab } from '../../hooks/useAdminNotes';
import type { CustomerScreenProps } from '../../navigation/types';
import type { OrderStatus } from '../../types';

export function HubDashboardScreen({ navigation }: CustomerScreenProps<'HubDashboard'>) {
  const { data: orders, isLoading, error, refetch, isRefetching } = useStaffOrders();
  const { mutateAsync: updateStatus, isPending: isUpdating } = useUpdateOrderStatus();
  // Hub-specific + broadcast notes from admin
  const { data: notes = [] } = useStaffNoteForTab('hub');
  // Realtime: invalidate cache on any order change so freshly-dispatched
  // orders appear without pull-to-refresh.
  useRealtimeOrders(true);

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="accent">‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">My Hub</ThemedText>
        <View style={styles.spacer} />
      </View>

      {/* Admin notes — hub-specific + broadcasts. Single-line, centered, mild yellow. */}
      {notes.map((n) => (
        <Text key={n.id} style={styles.noteLine} numberOfLines={1}>{n.note_text}</Text>
      ))}

      {error ? (
        <ErrorRetry message="Failed to load hub orders" onRetry={refetch} />
      ) : (
        <FlatList
          data={orders ?? []}
          keyExtractor={(o: any) => String(o.id)}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Theme.colors.text.mint} />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            !isLoading ? <EmptyState title="No orders for your hub today" /> : null
          }
          ItemSeparatorComponent={() => <Divider />}
          renderItem={({ item }) => (
            <DeliveryOrderRow
              order={item}
              onAdvanceStatus={handleAdvanceStatus}
              isUpdating={isUpdating}
              persona="hub_operator"
            />
          )}
        />
      )}

      {isLoading && !orders && (
        <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
      )}
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
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  spacer: { minWidth: 60 },
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
});
