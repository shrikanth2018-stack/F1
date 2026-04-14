/**
 * 1stOne F1 — Order Detail Screen
 * Shows full order info: items, status timeline, address, payment.
 * Dispatch time shown next to current status from delivery cycle.
 */

import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { DispatchBadge } from '../../components/DispatchBadge';
import { Divider } from '../../components/Divider';
import { ErrorRetry } from '../../components/ErrorRetry';
import { useOrderDetail } from '../../hooks/useOrders';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useSupabaseQuery } from '../../api/useSupabaseQuery';
import { supabase } from '../../api/supabaseClient';
import { formatPriceShort, formatDateLong, formatOrderStatus } from '../../utils/formatters';
import { formatTime12h } from '../../utils/timeEngine';
import type { OrderItem } from '../../types';

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

  const { data: orderItems } = useSupabaseQuery<OrderItem>(
    ['order_items', orderId],
    () =>
      supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId),
  );

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
            <ThemedText variant="body" color="muted" style={styles.sectionLabel}>
              STATUS
            </ThemedText>
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
