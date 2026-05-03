/**
 * 1stOne F1 — Admin Order Detail Screen
 *
 * Single canonical surface for admin actions on one order. Reached by
 * tapping a row in AdminOrdersScreen ("Manage Running Orders").
 *
 * Shows: customer name + phone (Call), address (Open in Maps), items,
 * payment, status pill, routing (hub or zone) + driver code, dispatch
 * timing.
 *
 * Actions (gated by status):
 *   - Advance Status — for delivery transitions {Dispatched →
 *     Received at Hub → On the Way → Delivered}, mirroring
 *     DeliveryOrderRow's nextDeliveryStatus logic.
 *   - Cancel + auto-refund — for cancellable statuses {Pending,
 *     Confirmed, Preparing, Ready, Packed} via useAdminCancelOrder.
 *
 * Both action hooks are reused from elsewhere in the codebase
 * unchanged.
 */

import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { ErrorRetry } from '../../components/ErrorRetry';
import { DispatchBadge } from '../../components/DispatchBadge';
import { supabase } from '../../api/supabaseClient';
import { useAdminCancelOrder } from '../../hooks/useAdminOrders';
import { useUpdateOrderStatus } from '../../hooks/useStaffOrders';
import { formatPriceShort, formatDateLong } from '../../utils/formatters';
import { nextDeliveryStatus } from '../../utils/deliveryStatus';
import type { AdminScreenProps } from '../../navigation/types';
import type { OrderStatus } from '../../types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

const CANCELLABLE = new Set(['Pending', 'Confirmed', 'Preparing', 'Ready', 'Packed']);

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'error'> = {
  Confirmed: 'info', Preparing: 'info', Ready: 'info', Packed: 'info',
  Dispatched: 'warning', 'On the Way': 'warning', Delivered: 'success',
  'Received at Hub': 'info', Cancelled: 'error', Pending: 'warning', Failed: 'error',
};

function useAdminOrderDetail(orderId: number) {
  return useQuery({
    queryKey: ['admin_order_detail', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          customer_addresses(
            *,
            delivery_hubs(hub_name, driver_code),
            delivery_zones(zone_name, driver_code)
          ),
          order_items(*),
          profiles!orders_user_id_fkey(full_name, phone_number)
        `)
        .eq('id', orderId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!orderId,
  });
}

export function AdminOrderDetailScreen({
  route,
  navigation,
}: AdminScreenProps<'AdminOrderDetail'>) {
  const { orderId } = route.params;
  const { data: order, isLoading, error, refetch } = useAdminOrderDetail(orderId);
  const { mutateAsync: cancelOrder, isPending: isCancelling } = useAdminCancelOrder();
  const { mutateAsync: updateStatus, isPending: isAdvancing } = useUpdateOrderStatus();

  const handleCall = () => {
    const phone =
      (order as any)?.customer_addresses?.phone_number ||
      (order as any)?.profiles?.phone_number;
    if (!phone) {
      Alert.alert('No phone', 'Customer phone number is missing.');
      return;
    }
    Linking.openURL(`tel:${phone}`);
  };

  const handleMap = () => {
    const addr = (order as any)?.customer_addresses;
    if (addr?.latitude != null && addr?.longitude != null) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${addr.latitude},${addr.longitude}`,
      );
      return;
    }
    if (addr) {
      const q = encodeURIComponent(`${addr.address_line ?? ''} ${addr.city ?? ''}`);
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
      return;
    }
    Alert.alert('No location', 'Address information is missing.');
  };

  const handleAdvance = (next: OrderStatus) => {
    if (!order) return;
    const o: any = order;
    Alert.alert(
      'Advance Status?',
      `Mark order #${o.id} as "${next}"?`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: `Set ${next}`,
          onPress: async () => {
            try {
              await updateStatus({
                orderId: o.id,
                status: next,
                userId: o.user_id ?? undefined,
              });
              refetch();
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Failed to update status');
            }
          },
        },
      ],
    );
  };

  const handleCancel = () => {
    if (!order) return;
    const o: any = order;
    const walletRefund = Number(o.wallet_amount_used ?? 0);
    const razorpayDue = Number(o.total_amount ?? 0) - walletRefund;
    const refundNote =
      walletRefund > 0
        ? `₹${walletRefund} returned to wallet instantly.${
            razorpayDue > 0 ? `\n₹${razorpayDue} Razorpay — process manually.` : ''
          }`
        : razorpayDue > 0
        ? `₹${razorpayDue} Razorpay — process manually.`
        : 'No refund due.';
    Alert.alert(
      `Cancel Order #${o.id}?`,
      refundNote,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Order',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelOrder({
                orderId: o.id,
                walletAmountUsed: walletRefund,
                userId: o.user_id ?? '',
                reason: 'Cancelled by admin',
              });
              Alert.alert(
                'Done',
                walletRefund > 0
                  ? `Order cancelled. ₹${walletRefund} refunded to wallet.`
                  : 'Order cancelled.',
              );
              refetch();
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Failed to cancel order');
            }
          },
        },
      ],
    );
  };

  if (error) return <ErrorRetry message="Could not load order" onRetry={refetch} />;
  if (isLoading || !order) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">Order #{orderId}</ThemedText>
          <View style={{ width: 40 }} />
        </View>
        <ActivityIndicator
          color={Theme.colors.action.primary}
          style={{ marginTop: Theme.spacing.xl }}
        />
      </SafeAreaView>
    );
  }

  const o: any = order;
  const addr = o.customer_addresses;
  const isHub = o.delivery_method === 'hub';
  const routingHub = isHub ? addr?.delivery_hubs : null;
  const routingZone = isHub ? null : addr?.delivery_zones;
  const routingLabel = routingHub
    ? `Hub · ${routingHub.hub_name ?? '—'}`
    : routingZone
    ? `Zone · ${routingZone.zone_name ?? '—'}`
    : 'Unrouted';
  const driverCode = routingHub?.driver_code ?? routingZone?.driver_code ?? null;

  // Admin gets the full-flow override (BF-11). Explicit at the callsite even
  // though 'admin' is the default — documents the persona choice here.
  const next = nextDeliveryStatus(o.status, o.delivery_method ?? null, 'admin');
  const canAdvance = next != null;
  const canCancel = CANCELLABLE.has(o.status);

  const items: any[] = o.order_items ?? [];
  const customerName = o.profiles?.full_name ?? addr?.full_name ?? '—';
  const phone = addr?.phone_number || o.profiles?.phone_number || null;
  const walletUsed = Number(o.wallet_amount_used ?? 0);
  const total = Number(o.total_amount ?? 0);
  const razorpayPortion = total - walletUsed;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">Order #{o.id}</ThemedText>
          <View style={{ width: 40 }} />
        </View>

        {/* Status + Routing */}
        <View style={styles.section}>
          <View style={styles.statusRow}>
            <DispatchBadge
              label={o.status ?? ''}
              variant={STATUS_VARIANT[o.status ?? ''] ?? 'info'}
            />
            <ThemedText variant="small" color="subtitle">{routingLabel}</ThemedText>
          </View>
          {driverCode && (
            <ThemedText variant="small" color="muted" style={styles.metaLine}>
              Driver: {driverCode}
            </ThemedText>
          )}
          <ThemedText variant="small" color="muted" style={styles.metaLine}>
            Dispatch date: {o.dispatch_date ? formatDateLong(o.dispatch_date) : '—'}
          </ThemedText>
        </View>

        <Divider />

        {/* Customer */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            CUSTOMER
          </ThemedText>
          <ThemedText variant="body" color="primary" style={styles.bodyLine}>
            {customerName}
          </ThemedText>
          {phone ? (
            <TouchableOpacity onPress={handleCall} style={styles.linkBtn} activeOpacity={0.6}>
              <ThemedText variant="small" color="mint">{phone}  ·  Call ☎</ThemedText>
            </TouchableOpacity>
          ) : (
            <ThemedText variant="small" color="muted">No phone on file</ThemedText>
          )}
        </View>

        {/* Address */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            DELIVERY ADDRESS
          </ThemedText>
          {addr ? (
            <>
              <ThemedText variant="body" color="primary" style={styles.bodyLine}>
                {addr.full_name ?? '—'}
              </ThemedText>
              <ThemedText variant="small" color="subtitle">{addr.address_line ?? '—'}</ThemedText>
              {addr.landmark ? (
                <ThemedText variant="small" color="muted">{addr.landmark}</ThemedText>
              ) : null}
              {addr.city ? (
                <ThemedText variant="small" color="muted">{addr.city}</ThemedText>
              ) : null}
              <TouchableOpacity onPress={handleMap} style={styles.linkBtn} activeOpacity={0.6}>
                <ThemedText variant="small" color="mint">Open in Maps  ⊙</ThemedText>
              </TouchableOpacity>
            </>
          ) : (
            <ThemedText variant="small" color="muted">No address on file</ThemedText>
          )}
        </View>

        {/* Items */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            ITEMS
          </ThemedText>
          {items.length === 0 ? (
            <ThemedText variant="small" color="muted">—</ThemedText>
          ) : (
            items.map((it) => (
              <View key={it.id} style={styles.itemRow}>
                <ThemedText variant="body" color="primary" style={styles.itemName} numberOfLines={1}>
                  {it.item_name ?? `Item #${it.item_id}`}
                </ThemedText>
                <ThemedText variant="body" color="subtitle">×{it.quantity ?? 1}</ThemedText>
              </View>
            ))
          )}
        </View>

        {/* Payment */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            PAYMENT
          </ThemedText>
          <View style={styles.payRow}>
            <ThemedText variant="body" color="primary">Total</ThemedText>
            <ThemedText variant="body" color="primary">{formatPriceShort(total)}</ThemedText>
          </View>
          {walletUsed > 0 && (
            <View style={styles.payRow}>
              <ThemedText variant="small" color="subtitle">Wallet portion</ThemedText>
              <ThemedText variant="small" color="subtitle">{formatPriceShort(walletUsed)}</ThemedText>
            </View>
          )}
          {razorpayPortion > 0 && (
            <View style={styles.payRow}>
              <ThemedText variant="small" color="subtitle">Razorpay portion</ThemedText>
              <ThemedText variant="small" color="subtitle">
                {formatPriceShort(razorpayPortion)}
              </ThemedText>
            </View>
          )}
          <ThemedText variant="small" color="muted" style={styles.metaLine}>
            Method: {o.payment_method ?? '—'}
          </ThemedText>
        </View>

        <Divider />

        {/* Actions */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            ACTIONS
          </ThemedText>
          {canAdvance && next && (
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.7}
              onPress={() => handleAdvance(next)}
              disabled={isAdvancing}
            >
              {isAdvancing ? (
                <ActivityIndicator color={Theme.colors.text.mint} />
              ) : (
                <ThemedText variant="body" color="mint">
                  Advance to {next}  ›
                </ThemedText>
              )}
            </TouchableOpacity>
          )}
          {canCancel && (
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.7}
              onPress={handleCancel}
              disabled={isCancelling}
            >
              {isCancelling ? (
                <ActivityIndicator color={Theme.colors.status.error} />
              ) : (
                <ThemedText variant="body" style={styles.cancelText}>
                  Cancel + Refund
                </ThemedText>
              )}
            </TouchableOpacity>
          )}
          {!canAdvance && !canCancel && (
            <ThemedText variant="small" color="muted">
              No actions available for this status.
            </ThemedText>
          )}
        </View>

        {/* Meta footer */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.metaLine}>
            Created: {o.created_at ? new Date(o.created_at).toLocaleString() : '—'}
          </ThemedText>
          {o.cycle_id != null && (
            <ThemedText variant="small" color="muted" style={styles.metaLine}>
              Cycle ID: {o.cycle_id}
            </ThemedText>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  scroll: { paddingBottom: Theme.spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  section: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: 4,
    fontSize: S - 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  metaLine: { marginTop: 2 },
  bodyLine: { fontSize: B },
  linkBtn: { paddingVertical: 4, alignSelf: 'flex-start' },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  itemName: { flex: 1, fontSize: B },
  payRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  actionBtn: {
    paddingVertical: Theme.spacing.sm,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  cancelText: {
    color: Theme.colors.status.error,
    fontWeight: '600',
    fontSize: B,
  },
});
