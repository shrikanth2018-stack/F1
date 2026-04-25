/**
 * 1stOne F1 — Hub Manager Dashboard
 *
 * Customer-role users whose profile has assigned_hub_id set unlock this screen
 * from the Profile popup. Shows today's orders routed to their hub, with the
 * two status actions they own:
 *   Dispatched      → Received at Hub   (batch arrived)
 *   Received at Hub → Delivered         (handed to customer)
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
import { DispatchBadge } from '../../components/DispatchBadge';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { useStaffOrders, useUpdateOrderStatus } from '../../hooks/useStaffOrders';
import { useStaffNoteForTab } from '../../hooks/useAdminNotes';
import { formatPriceShort } from '../../utils/formatters';
import type { CustomerScreenProps } from '../../navigation/types';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'error'> = {
  Confirmed: 'info', Preparing: 'info', Ready: 'info', Packed: 'info',
  Dispatched: 'warning', 'On the Way': 'warning', Delivered: 'success',
  'Received at Hub': 'info', Cancelled: 'error', Pending: 'warning', Failed: 'error',
};

export function HubDashboardScreen({ navigation }: CustomerScreenProps<'HubDashboard'>) {
  const { data: orders, isLoading, error, refetch, isRefetching } = useStaffOrders();
  const { mutateAsync: updateStatus, isPending } = useUpdateOrderStatus();
  // Hub-specific + broadcast notes from admin
  const { data: notes = [] } = useStaffNoteForTab('hub');

  const handleAction = (orderId: number, userId: string | null, current: string) => {
    const next = current === 'Dispatched' ? 'Received at Hub'
      : current === 'Received at Hub' ? 'Delivered'
      : null;
    if (!next) return;

    Alert.alert(
      'Confirm',
      `Mark order #${orderId} as ${next}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              await updateStatus({ orderId, status: next as any, userId: userId ?? undefined });
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to update status');
            }
          },
        },
      ]
    );
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
          keyExtractor={(o) => String(o.id)}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Theme.colors.text.mint} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            !isLoading ? <EmptyState title="No orders for your hub today" /> : null
          }
          ItemSeparatorComponent={() => <Divider />}
          renderItem={({ item }) => {
            const status = item.status ?? '';
            const actionable = status === 'Dispatched' || status === 'Received at Hub';
            const actionLabel = status === 'Dispatched' ? 'Mark Received'
              : status === 'Received at Hub' ? 'Mark Delivered'
              : '';
            return (
              <View style={styles.row}>
                <View style={styles.rowTop}>
                  <ThemedText variant="body" color="primary">#{item.id}</ThemedText>
                  <DispatchBadge label={status} variant={STATUS_VARIANT[status] ?? 'info'} />
                </View>
                <ThemedText variant="small" color="subtitle" style={styles.sub}>
                  {formatPriceShort(item.total_amount ?? 0)}
                  {item.order_items?.length ? `  •  ${item.order_items.length} items` : ''}
                </ThemedText>
                {actionable && (
                  <TouchableOpacity
                    style={styles.actionBtn}
                    activeOpacity={0.7}
                    disabled={isPending}
                    onPress={() => handleAction(item.id, item.user_id ?? null, status)}
                  >
                    <ThemedText variant="small" color="mint">{actionLabel}  ›</ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
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
  row: { paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sub: { marginBottom: Theme.spacing.xs },
  actionBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  loader: { marginTop: Theme.spacing.xl },
});
