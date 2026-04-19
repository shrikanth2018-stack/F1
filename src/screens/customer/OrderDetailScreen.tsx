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
import { DispatchBadge } from '../../components/DispatchBadge';
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

const CANCELLABLE_STATUSES = new Set(['Pending', 'Confirmed', 'Preparing']);

const STATUS_FLOW = [
  'Confirmed',
  'Preparing',
  'Ready',
  'Packed',
  'Dispatched',
  'On the Way',
  'Delivered',
];

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
              await cancelOrder({ order_id: order.id });
              refetch();
              Alert.alert('Order Cancelled', walletRefund > 0 ? `₹${walletRefund} has been added back to your wallet.` : 'Your order has been cancelled.');
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

  const currentStatusIndex = STATUS_FLOW.indexOf(order.status);
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

        {/* Dispatch date + scheduled time */}
        <View style={styles.section}>
          <View style={styles.statusRow}>
            <ThemedText variant="body" color="subtitle">
              {formatDateLong(order.dispatch_date)}
            </ThemedText>
            {dispatchCycle && (
              <ThemedText variant="body" color="mint">
                Scheduled to dispatch by : {dispatchTime}
              </ThemedText>
            )}
          </View>
        </View>

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
            {STATUS_FLOW.map((status, index) => {
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
                  {index < STATUS_FLOW.length - 1 && (
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
