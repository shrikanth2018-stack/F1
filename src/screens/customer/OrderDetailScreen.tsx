/**
 * 1stOne F1 — Order Detail Screen
 * Shows full order info: items, status timeline, address, payment.
 * Dispatch time shown next to current status from delivery cycle.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { ErrorRetry } from '../../components/ErrorRetry';
import { useOrderDetail, useCancelOrder } from '../../hooks/useOrders';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { useSupabaseQuery } from '../../api/useSupabaseQuery';
import { supabase } from '../../api/supabaseClient';
import { formatPriceShort, formatDateLong, formatOrderStatus } from '../../utils/formatters';
import { formatTime12h } from '../../utils/timeEngine';
import type { OrderItem } from '../../types';

// 'Paid' = Razorpay webhook confirmed but kitchen hasn't started yet — still cancellable
const CANCELLABLE_STATUSES = new Set(['Pending', 'Confirmed', 'Paid', 'Preparing']);

// Progress bar flows — per blueprint Sec 5.1.
// Food includes kitchen prep states; Essentials skips them (no cooking).
// "Received at Hub" only appears when the order is going via a hub.
const FOOD_FLOW       = ['Confirmed', 'Preparing', 'Ready', 'Packed', 'Dispatched', 'On the Way', 'Delivered'];
const ESSENTIALS_FLOW = ['Confirmed', 'Packed', 'Dispatched', 'On the Way', 'Delivered'];

function buildStatusFlow(orderType: string | null | undefined, deliveryMethod: string | null | undefined): string[] {
  const base = (orderType === 'essential' || orderType === 'essentials') ? ESSENTIALS_FLOW : FOOD_FLOW;
  if (deliveryMethod !== 'hub') return base;
  // Insert "Received at Hub" between Dispatched and On the Way
  const out = [...base];
  const dispatchedIdx = out.indexOf('Dispatched');
  if (dispatchedIdx >= 0) out.splice(dispatchedIdx + 1, 0, 'Received at Hub');
  return out;
}

export function OrderDetailScreen({ route, navigation }: any) {
  const { orderId } = route.params;
  const { data: orders, isLoading, error, refetch } = useOrderDetail(orderId);
  const order = orders?.[0];

  const { data: cycles } = useDeliveryCycles();
  const { data: config } = useStoreConfig();
  const { mutateAsync: cancelOrder } = useCancelOrder();
  const [isCancelling, setIsCancelling] = useState(false);

  const { data: orderItems } = useSupabaseQuery<OrderItem>(
    ['order_items', orderId],
    () =>
      supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId),
  );

  // Must be before early returns — Rules of Hooks
  const handleCancel = useCallback(() => {
    if (!order) return;
    const walletRefund = order.wallet_amount_used ?? 0;
    const razorpayDue = order.total_amount - walletRefund;
    const refundNote = walletRefund > 0
      ? `₹${walletRefund} will be returned to your wallet instantly.${razorpayDue > 0 ? ` ₹${razorpayDue} Razorpay refund will be processed by admin.` : ''}`
      : 'Razorpay refund will be processed by admin.';

    Alert.alert(
      'Cancel Order?',
      `This cannot be undone.\n\n${refundNote}`,
      [
        { text: 'Keep Order', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            setIsCancelling(true);
            try {
              const result = await cancelOrder({ order_id: order.id });
              const serverWallet = (result as any)?.data?.wallet_refunded ?? walletRefund;
              const serverRzp = (result as any)?.data?.razorpay_refund_due ?? 0;
              refetch();

              let msg = 'Your order has been cancelled.';
              if (serverWallet > 0 && serverRzp > 0) {
                msg = `₹${serverWallet} returned to your wallet. ₹${serverRzp} Razorpay refund will be processed within 5–7 business days.`;
              } else if (serverWallet > 0) {
                msg = `₹${serverWallet} has been returned to your wallet.`;
              } else if (serverRzp > 0) {
                msg = `Your order has been cancelled. ₹${serverRzp} Razorpay refund will be processed within 5–7 business days.`;
              }
              Alert.alert('Order Cancelled', msg);
            } catch (err: any) {
              Alert.alert('Cannot Cancel', err?.message ?? 'Something went wrong.');
            } finally {
              setIsCancelling(false);
            }
          },
        },
      ]
    );
  }, [order, cancelOrder, refetch]);

  if (error) {
    return <ErrorRetry message="Could not load order" onRetry={refetch} />;
  }

  if (isLoading || !order) {
    return (
      <SafeAreaView style={styles.container}>
        <ThemedText variant="body" color="subtitle" style={styles.loading}>
          Loading...
        </ThemedText>
      </SafeAreaView>
    );
  }

  const statusFlow = buildStatusFlow((order as any).order_type, (order as any).delivery_method);
  const currentStatusIndex = statusFlow.indexOf(order.status);
  const dispatchCycle = (cycles ?? []).find((c) => c.id === order.cycle_id);
  const dispatchTime = formatTime12h(dispatchCycle?.delivery_start);

  const windowHours = config?.cancellation_window_hours ?? 2;
  const ageHours = (Date.now() - new Date(order.created_at).getTime()) / 3_600_000;

  const orderCycle = (cycles ?? []).find((c) => c.id === order.cycle_id);
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(Date.now() + istOffsetMs);
  const todayISTStr    = nowIST.toISOString().split('T')[0];
  const tomorrowISTStr = new Date(Date.now() + istOffsetMs + 86_400_000).toISOString().split('T')[0];
  let cutoffPassed = false;
  if (orderCycle) {
    const [cutH, cutM] = orderCycle.cutoff_time.split(':').map(Number);
    const cutoffMins = cutH * 60 + cutM;
    const nowMins = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
    const isCrossMidnight = orderCycle.cutoff_time > orderCycle.delivery_start;
    const cutoffReached = nowMins >= cutoffMins;
    cutoffPassed =
      (!isCrossMidnight && order.dispatch_date === todayISTStr    && cutoffReached) ||
      ( isCrossMidnight && order.dispatch_date === tomorrowISTStr && cutoffReached);
  }

  const canCancel = CANCELLABLE_STATUSES.has(order.status) && ageHours <= windowHours && !cutoffPassed;

  const cancelRefundLine = (() => {
    if (order.status !== 'Cancelled') return '';
    const w = order.wallet_amount_used ?? 0;
    const r = Math.max(0, order.total_amount - w);
    if (w > 0 && r > 0) return `₹${w} returned to wallet · ₹${r} Razorpay refund in 5–7 days`;
    if (w > 0) return `₹${w} returned to your wallet`;
    if (r > 0) return `₹${r} Razorpay refund will be processed in 5–7 business days`;
    return '';
  })();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">Order #{order.id}</ThemedText>
          <View style={{ width: 40 }} />
        </View>

        {/* Dispatch date + scheduled time — stacked, dispatch line right-aligned and smaller */}
        <View style={styles.section}>
          <View style={styles.statusRow}>
            <ThemedText variant="body" color="subtitle">
              {formatDateLong(order.dispatch_date)}
            </ThemedText>
            {dispatchCycle && (
              <ThemedText variant="small" color="muted" style={styles.dispatchScheduledLine}>
                Scheduled to dispatch by {dispatchTime}
              </ThemedText>
            )}
          </View>
        </View>

        {/* Cancelled banner */}
        {order.status === 'Cancelled' && (
          <View style={styles.cancelledBanner}>
            <ThemedText variant="subtitle" style={styles.cancelledTitle}>Order Cancelled</ThemedText>
            {cancelRefundLine ? (
              <ThemedText variant="small" color="muted" style={styles.cancelledRefund}>{cancelRefundLine}</ThemedText>
            ) : null}
          </View>
        )}

        {/* Status Timeline */}
        {order.status !== 'Cancelled' && (
          <View style={styles.section}>
            <View style={styles.statusHeader}>
              <ThemedText variant="body" color="muted" style={[styles.sectionLabel, { marginBottom: 0 }]}>
                STATUS
              </ThemedText>
              {canCancel && (
                isCancelling
                  ? <ActivityIndicator color={Theme.colors.status.error} size="small" />
                  : (
                    <TouchableOpacity onPress={handleCancel} activeOpacity={0.6}>
                      <ThemedText variant="body" style={styles.cancelText}>Cancel Order</ThemedText>
                    </TouchableOpacity>
                  )
              )}
            </View>
            {statusFlow.map((status, index) => {
              const isCompleted = index <= currentStatusIndex;
              const isCurrent = index === currentStatusIndex;
              return (
                <View key={status} style={styles.timelineRow}>
                  <View
                    style={[
                      styles.dot,
                      isCompleted && styles.dotCompleted,
                      isCurrent && styles.dotCurrent,
                    ]}
                  />
                  {index < statusFlow.length - 1 && (
                    <View
                      style={[
                        styles.line,
                        isCompleted && styles.lineCompleted,
                      ]}
                    />
                  )}
                  <ThemedText
                    variant="body"
                    color={isCompleted ? 'primary' : 'muted'}
                    style={styles.timelineLabel}
                  >
                    {status}
                  </ThemedText>
                </View>
              );
            })}
            {order.status === 'Delivered' && (
              <TouchableOpacity
                onPress={() => navigation.navigate('Feedback', { orderId: order.id })}
                style={styles.reviewLink}
              >
                <ThemedText variant="body" color="mint">Leave a Review ›</ThemedText>
              </TouchableOpacity>
            )}
            {canCancel && (
              <ThemedText variant="micro" color="muted" style={styles.cancelHint}>
                {orderCycle
                  ? `Cancellable within ${windowHours}h of placing or before ${orderCycle.cutoff_time.slice(0, 5)} cutoff`
                  : `Cancellable within ${windowHours}h of placing`}
              </ThemedText>
            )}
          </View>
        )}

        <Divider />

        {/* Items */}
        <View style={styles.section}>
          <ThemedText variant="body" color="muted" style={styles.sectionLabel}>
            ITEMS
          </ThemedText>
          {(orderItems ?? []).map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <ThemedText variant="body" color="primary">
                {item.item_name} x{item.quantity}
              </ThemedText>
              <ThemedText variant="body" color="mint">
                {formatPriceShort(item.price_at_time * item.quantity)}
              </ThemedText>
            </View>
          ))}
        </View>

        <Divider />

        {/* Totals */}
        <View style={styles.section}>
          <View style={styles.itemRow}>
            <ThemedText variant="body" color="subtitle">Subtotal</ThemedText>
            <ThemedText variant="body" color="subtitle">
              {formatPriceShort(order.total_amount - order.tax_amount - order.delivery_fee)}
            </ThemedText>
          </View>
          <View style={styles.itemRow}>
            <ThemedText variant="body" color="subtitle">Tax</ThemedText>
            <ThemedText variant="body" color="subtitle">
              {formatPriceShort(order.tax_amount)}
            </ThemedText>
          </View>
          <View style={styles.itemRow}>
            <ThemedText variant="body" color="subtitle">Delivery</ThemedText>
            <ThemedText variant="body" color="subtitle">
              {order.delivery_fee === 0 ? 'Free' : formatPriceShort(order.delivery_fee)}
            </ThemedText>
          </View>
          <View style={[styles.itemRow, styles.totalRow]}>
            <ThemedText variant="subtitle" color="primary">Total</ThemedText>
            <ThemedText variant="subtitle" color="mint">
              {formatPriceShort(order.total_amount)}
            </ThemedText>
          </View>
        </View>

        {/* Payment */}
        <Divider />
        <View style={styles.section}>
          <ThemedText variant="body" color="muted" style={styles.sectionLabel}>
            PAYMENT
          </ThemedText>
          <ThemedText variant="body" color="primary">
            {formatOrderStatus(order.payment_method)}
          </ThemedText>
          {order.wallet_amount_used > 0 && (
            <ThemedText variant="body" color="subtitle">
              Wallet: {formatPriceShort(order.wallet_amount_used)}
            </ThemedText>
          )}
        </View>


      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { paddingBottom: Theme.spacing.xl },
  loading: { textAlign: 'center', marginTop: Theme.spacing.xl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  section: { padding: Theme.spacing.md },
  sectionLabel: { letterSpacing: 1, marginBottom: Theme.spacing.sm },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  statusRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  dispatchScheduledLine: {
    textAlign: 'right',
    marginTop: 2,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Theme.colors.background.input,
    marginRight: Theme.spacing.sm,
  },
  dotCompleted: { backgroundColor: Theme.colors.status.success },
  dotCurrent: {
    backgroundColor: Theme.colors.action.primary,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  line: {
    position: 'absolute',
    left: 4,
    top: 12,
    width: 2,
    height: 18,
    backgroundColor: Theme.colors.background.input,
  },
  lineCompleted: { backgroundColor: Theme.colors.status.success },
  timelineLabel: { flex: 1, paddingVertical: 6 },
  reviewLink: { marginTop: Theme.spacing.sm },
  cancelText: {
    color: Theme.colors.status.error,
    fontWeight: '600',
  },
  cancelHint: {
    textAlign: 'center',
    marginTop: Theme.spacing.xs,
  },
  cancelledBanner: {
    margin: Theme.spacing.md,
    padding: Theme.spacing.md,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.status.error,
    alignItems: 'center',
    gap: 6,
  },
  cancelledTitle: {
    color: Theme.colors.status.error,
  },
  cancelledRefund: {
    textAlign: 'center',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  totalRow: {
    marginTop: Theme.spacing.xs,
    paddingTop: Theme.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.layout.divider,
  },
});
