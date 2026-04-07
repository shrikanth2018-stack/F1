/**
 * 1stOne F1 — Order Detail Screen
 * Shows full order info: items, status timeline, address, payment.
 */

import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { DispatchBadge } from '../../components/DispatchBadge';
import { Divider } from '../../components/Divider';
import { ErrorRetry } from '../../components/ErrorRetry';
import { useOrderDetail } from '../../hooks/useOrders';
import { useSupabaseQuery } from '../../api/useSupabaseQuery';
import { supabase } from '../../api/supabaseClient';
import { formatPriceShort, formatDateLong, formatOrderStatus } from '../../utils/formatters';
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">
              ‹ Back
            </ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">
            Order #{order.id}
          </ThemedText>
          <View style={{ width: 40 }} />
        </View>

        {/* Status */}
        <View style={styles.section}>
          <DispatchBadge
            label={order.status}
            variant={
              order.status === 'Delivered'
                ? 'success'
                : order.status === 'Cancelled'
                ? 'error'
                : 'info'
            }
          />
          <ThemedText variant="small" color="subtitle" style={styles.date}>
            {formatDateLong(order.dispatch_date)}
          </ThemedText>
        </View>

        {/* Status Timeline */}
        {order.status !== 'Cancelled' && (
          <View style={styles.section}>
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
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
                    variant="small"
                    color={isCompleted ? 'primary' : 'muted'}
                    style={styles.timelineLabel}
                  >
                    {status}
                  </ThemedText>
                </View>
              );
            })}
          </View>
        )}

        <Divider />

        {/* Items */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            ITEMS
          </ThemedText>
          {(orderItems ?? []).map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <ThemedText variant="body" color="primary">
                {item.item_name} x{item.quantity}
              </ThemedText>
              <ThemedText variant="body" color="subtitle">
                {formatPriceShort(item.price_at_time * item.quantity)}
              </ThemedText>
            </View>
          ))}
        </View>

        <Divider />

        {/* Totals */}
        <View style={styles.section}>
          <View style={styles.itemRow}>
            <ThemedText variant="small" color="subtitle">Subtotal</ThemedText>
            <ThemedText variant="small" color="subtitle">
              {formatPriceShort(order.total_amount - order.tax_amount - order.delivery_fee)}
            </ThemedText>
          </View>
          <View style={styles.itemRow}>
            <ThemedText variant="small" color="subtitle">Tax</ThemedText>
            <ThemedText variant="small" color="subtitle">
              {formatPriceShort(order.tax_amount)}
            </ThemedText>
          </View>
          <View style={styles.itemRow}>
            <ThemedText variant="small" color="subtitle">Delivery</ThemedText>
            <ThemedText variant="small" color="subtitle">
              {order.delivery_fee === 0 ? 'Free' : formatPriceShort(order.delivery_fee)}
            </ThemedText>
          </View>
          <View style={[styles.itemRow, styles.totalRow]}>
            <ThemedText variant="subtitle" color="primary">Total</ThemedText>
            <ThemedText variant="subtitle" color="accent">
              {formatPriceShort(order.total_amount)}
            </ThemedText>
          </View>
        </View>

        {/* Payment */}
        <Divider />
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            PAYMENT
          </ThemedText>
          <ThemedText variant="body" color="primary">
            {formatOrderStatus(order.payment_method)}
          </ThemedText>
          {order.wallet_amount_used > 0 && (
            <ThemedText variant="small" color="subtitle">
              Wallet: {formatPriceShort(order.wallet_amount_used)}
            </ThemedText>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  content: {
    paddingBottom: Theme.spacing.xl,
  },
  loading: {
    textAlign: 'center',
    marginTop: Theme.spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  section: {
    padding: Theme.spacing.md,
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: Theme.spacing.sm,
  },
  date: {
    marginTop: Theme.spacing.xs,
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
  dotCompleted: {
    backgroundColor: Theme.colors.status.success,
  },
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
  lineCompleted: {
    backgroundColor: Theme.colors.status.success,
  },
  timelineLabel: {
    flex: 1,
    paddingVertical: 6,
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
