/**
 * 1stOne F1 — Admin Running Orders Screen
 * Lists orders by date with cancel + wallet refund.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { DispatchBadge } from '../../components/DispatchBadge';
import { useAdminCancelOrder } from '../../hooks/useAdminOrders';
import { supabase } from '../../api/supabaseClient';
import { formatPriceShort, formatDateShort } from '../../utils/formatters';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'error'> = {
  Confirmed: 'info', Preparing: 'info', Ready: 'info', Packed: 'info',
  Dispatched: 'warning', 'On the Way': 'warning', Delivered: 'success',
  'Received at Hub': 'info', Cancelled: 'error', Pending: 'warning', Failed: 'error',
};

const CANCELLABLE = new Set(['Pending', 'Confirmed', 'Preparing', 'Ready', 'Packed']);

function getDateStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

function useOrdersForDate(date: string) {
  return useQuery({
    queryKey: ['admin_orders_manage', date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, user_id, status, total_amount, wallet_amount_used, payment_method, order_type, cycle_id')
        .eq('dispatch_date', date)
        .order('created_at', { ascending: false });
      if (error) throw error;

      if (!data || data.length === 0) return [];

      const userIds = [...new Set(data.map((o) => o.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, phone_number')
        .in('id', userIds);

      const profileMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));

      const orderIds = data.map((o) => o.id);
      const { data: items } = await supabase
        .from('order_items')
        .select('order_id, item_name, quantity')
        .in('order_id', orderIds);

      const itemsMap: Record<number, { item_name: string; quantity: number }[]> = {};
      for (const item of items ?? []) {
        if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
        itemsMap[item.order_id].push(item);
      }

      return data.map((o) => ({
        ...o,
        profile: profileMap[o.user_id] ?? null,
        items: itemsMap[o.id] ?? [],
      }));
    },
  });
}

export function AdminOrdersScreen({ navigation }: any) {
  const [dateOffset, setDateOffset] = useState(0);
  const date = getDateStr(dateOffset);

  const { data: orders, isLoading, error, refetch } = useOrdersForDate(date);
  const { mutateAsync: cancelOrder } = useAdminCancelOrder();

  const handleCancel = useCallback((order: any) => {
    const walletRefund = Number(order.wallet_amount_used ?? 0);
    const razorpayDue = Number(order.total_amount) - walletRefund;
    const customer = order.profile?.full_name ?? order.profile?.phone_number ?? `#${order.id}`;

    const refundNote = walletRefund > 0
      ? `₹${walletRefund} returned to wallet instantly.${razorpayDue > 0 ? `\n₹${razorpayDue} Razorpay — process manually.` : ''}`
      : razorpayDue > 0
        ? `₹${razorpayDue} Razorpay — process manually.`
        : 'No refund due.';

    Alert.alert(
      `Cancel Order #${order.id}?`,
      `${customer}\n\n${refundNote}`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Order',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelOrder({
                orderId: order.id,
                walletAmountUsed: walletRefund,
                userId: order.user_id,
                reason: 'Cancelled by admin',
              });
              Alert.alert('Done', walletRefund > 0
                ? `Order cancelled. ₹${walletRefund} refunded to wallet.`
                : 'Order cancelled.');
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Failed to cancel order');
            }
          },
        },
      ]
    );
  }, [cancelOrder]);

  if (error) return <ErrorRetry message="Could not load orders" onRetry={refetch} />;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Running Orders</ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      <View style={styles.dateRow}>
        <TouchableOpacity onPress={() => setDateOffset((d) => d - 1)} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
          <ThemedText variant="subtitle" color="mint" style={styles.txt}>‹</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="body" color="primary" style={styles.txt}>{formatDateShort(date)}</ThemedText>
        <TouchableOpacity onPress={() => setDateOffset((d) => d + 1)} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
          <ThemedText variant="subtitle" color="mint" style={styles.txt}>›</ThemedText>
        </TouchableOpacity>
      </View>

      <Divider />

      {isLoading && (
        <ActivityIndicator color={Theme.colors.action.primary} style={{ marginTop: Theme.spacing.xl }} />
      )}

      <FlatList
        data={orders ?? []}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={!isLoading ? <EmptyState title="No orders for this date" /> : null}
        ItemSeparatorComponent={() => <Divider />}
        renderItem={({ item }) => {
          const customer = item.profile?.full_name ?? item.profile?.phone_number ?? `Order #${item.id}`;
          const itemsLabel = item.items.length > 0
            ? item.items.map((i: any) => `${i.item_name} x${i.quantity}`).join(', ')
            : '—';
          return (
            <View style={styles.row}>
              <View style={styles.rowTop}>
                <ThemedText variant="body" color="primary" style={styles.txt}>
                  #{item.id} — {customer}
                </ThemedText>
                <DispatchBadge label={item.status} variant={STATUS_VARIANT[item.status] ?? 'info'} />
              </View>
              <ThemedText variant="small" color="subtitle" style={[styles.sub, { marginBottom: 4 }]}>
                {itemsLabel}
              </ThemedText>
              <View style={styles.rowBottom}>
                <ThemedText variant="small" color="muted" style={styles.sub}>
                  {formatPriceShort(item.total_amount)}
                  {item.wallet_amount_used > 0 ? `  (₹${item.wallet_amount_used} wallet)` : ''}
                </ThemedText>
                {CANCELLABLE.has(item.status) && (
                  <TouchableOpacity onPress={() => handleCancel(item)} activeOpacity={0.6}>
                    <ThemedText variant="small" style={styles.cancelText}>Cancel</ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        }}
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
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  title: { flex: 1, textAlign: 'center' },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.xl,
  },
  list: { paddingBottom: Theme.spacing.xl },
  row: { paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm + 2 },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  rowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cancelText: { color: Theme.colors.status.error, fontWeight: '600', fontSize: S },
  txt: { fontSize: B },
  sub: { fontSize: S },
});
