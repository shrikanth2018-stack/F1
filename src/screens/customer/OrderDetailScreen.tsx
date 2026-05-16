/**
 * 1stOne F1 — Order Detail Screen
 *
 * MF-10: a customer "order" can span multiple delivery cycles. This
 * screen resolves the whole order group (via useOrderGroup) and renders
 * ONE schedule section per dispatch row — each with its own status
 * timeline, dispatch date and items — followed by one shared totals /
 * payment block. Cancellation acts on the whole group.
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
import { useOrderGroup, useCancelOrder, type OrderWithItems } from '../../hooks/useOrders';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { formatPriceShort, formatDateLong, formatOrderStatus } from '../../utils/formatters';
import { formatTime12h } from '../../utils/timeEngine';

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
  const { data: rows, isLoading, error, refetch } = useOrderGroup(orderId);

  const { data: cycles } = useDeliveryCycles();
  const { data: config } = useStoreConfig();
  const { mutateAsync: cancelOrder } = useCancelOrder();
  const [isCancelling, setIsCancelling] = useState(false);

  // ── Group-level derived values (safe on empty — guarded before use) ──
  const groupRows: OrderWithItems[] = rows ?? [];
  const primaryId = groupRows.length > 0 ? Math.min(...groupRows.map((r) => r.id)) : orderId;
  const allCancelled = groupRows.length > 0 && groupRows.every((r) => r.status === 'Cancelled');

  const groupTotal    = groupRows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
  const groupTax      = groupRows.reduce((s, r) => s + (Number(r.tax_amount) || 0), 0);
  const groupDelivery = groupRows.reduce((s, r) => s + (Number(r.delivery_fee) || 0), 0);
  const groupSubtotal = groupTotal - groupTax - groupDelivery;
  const groupWallet   = groupRows.reduce((s, r) => s + (Number(r.wallet_amount_used) || 0), 0);

  // ── Cancellation eligibility (whole group) ──────────────────
  const windowHours = config?.cancellation_window_hours ?? 2;
  const earliestCreatedMs = groupRows.length > 0
    ? Math.min(...groupRows.map((r) => new Date(r.created_at).getTime()))
    : Date.now();
  const ageHours = (Date.now() - earliestCreatedMs) / 3_600_000;
  const cancellableRows = groupRows.filter((r) => CANCELLABLE_STATUSES.has(r.status));

  // Earliest-dispatch row governs the cutoff guard (the "1st item" rule).
  const earliestRow = groupRows[0]; // useOrderGroup sorts by dispatch_date asc
  const earliestCycle = (cycles ?? []).find((c) => c.id === earliestRow?.cycle_id);
  let earliestCutoffPassed = false;
  if (earliestRow && earliestCycle) {
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(Date.now() + istOffsetMs);
    const todayISTStr    = nowIST.toISOString().split('T')[0];
    const tomorrowISTStr = new Date(Date.now() + istOffsetMs + 86_400_000).toISOString().split('T')[0];
    const [cutH, cutM] = earliestCycle.cutoff_time.split(':').map(Number);
    const cutoffMins = cutH * 60 + cutM;
    const nowMins = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
    const isCrossMidnight = earliestCycle.cutoff_time > earliestCycle.delivery_start;
    const cutoffReached = nowMins >= cutoffMins;
    earliestCutoffPassed =
      (!isCrossMidnight && earliestRow.dispatch_date === todayISTStr    && cutoffReached) ||
      ( isCrossMidnight && earliestRow.dispatch_date === tomorrowISTStr && cutoffReached);
  }

  const canCancel =
    cancellableRows.length > 0 && ageHours <= windowHours && !earliestCutoffPassed && !allCancelled;

  // Must be before early returns — Rules of Hooks
  const handleCancel = useCallback(() => {
    if (groupRows.length === 0) return;
    const razorpayDue = Math.max(0, groupTotal - groupWallet);
    const refundNote = groupWallet > 0
      ? `₹${groupWallet} will be returned to your wallet instantly.${razorpayDue > 0 ? ` ₹${razorpayDue} Razorpay refund will be processed by admin.` : ''}`
      : 'Razorpay refund will be processed by admin.';

    Alert.alert(
      'Cancel Order?',
      `This cancels every delivery in this order and cannot be undone.\n\n${refundNote}`,
      [
        { text: 'Keep Order', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            setIsCancelling(true);
            try {
              const result = await cancelOrder({ order_id: primaryId });
              const serverWallet = (result as any)?.wallet_refunded ?? groupWallet;
              const serverRzp = (result as any)?.razorpay_refund_due ?? 0;
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
  }, [groupRows, groupTotal, groupWallet, primaryId, cancelOrder, refetch]);

  if (error) {
    return <ErrorRetry message="Could not load order" onRetry={refetch} />;
  }

  if (isLoading || groupRows.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <ThemedText variant="body" color="subtitle" style={styles.loading}>
          Loading...
        </ThemedText>
      </SafeAreaView>
    );
  }

  const isMulti = groupRows.length > 1;
  const statusFlow = buildStatusFlow(groupRows[0].order_type, groupRows[0].delivery_method);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">Order #{primaryId}</ThemedText>
          <View style={{ width: 40 }} />
        </View>

        {/* Cancelled banner — whole group cancelled */}
        {allCancelled && (
          <View style={styles.cancelledBanner}>
            <ThemedText variant="subtitle" style={styles.cancelledTitle}>Order Cancelled</ThemedText>
            {(() => {
              const r = Math.max(0, groupTotal - groupWallet);
              let line = '';
              if (groupWallet > 0 && r > 0) line = `₹${groupWallet} returned to wallet · ₹${r} Razorpay refund in 5–7 days`;
              else if (groupWallet > 0) line = `₹${groupWallet} returned to your wallet`;
              else if (r > 0) line = `₹${r} Razorpay refund will be processed in 5–7 business days`;
              return line ? (
                <ThemedText variant="small" color="muted" style={styles.cancelledRefund}>{line}</ThemedText>
              ) : null;
            })()}
          </View>
        )}

        {/* Group-level cancel action */}
        {canCancel && (
          <View style={styles.cancelBar}>
            {isCancelling ? (
              <ActivityIndicator color={Theme.colors.status.error} size="small" />
            ) : (
              <TouchableOpacity onPress={handleCancel} activeOpacity={0.6}>
                <ThemedText variant="body" style={styles.cancelText}>Cancel Order</ThemedText>
              </TouchableOpacity>
            )}
            <ThemedText variant="micro" color="muted" style={styles.cancelHint}>
              {isMulti
                ? `Cancelling removes all ${groupRows.length} deliveries in this order`
                : earliestCycle
                  ? `Cancellable within ${windowHours}h of placing or before ${earliestCycle.cutoff_time.slice(0, 5)} cutoff`
                  : `Cancellable within ${windowHours}h of placing`}
            </ThemedText>
          </View>
        )}

        {/* ── One section per dispatch schedule ───────────────── */}
        {groupRows.map((row) => {
          const cycle = (cycles ?? []).find((c) => c.id === row.cycle_id);
          const dispatchTime = formatTime12h(cycle?.delivery_start);
          const currentStatusIndex = statusFlow.indexOf(row.status);
          const rowCancelled = row.status === 'Cancelled';

          // Hide "Scheduled to dispatch by" once the dispatch window has passed.
          const dispatchPassed = (() => {
            if (!cycle?.delivery_start || !row.dispatch_date) return false;
            const [hh, mm] = cycle.delivery_start.split(':').map(Number);
            if (Number.isNaN(hh) || Number.isNaN(mm)) return false;
            const dispatchAt = new Date(row.dispatch_date);
            dispatchAt.setHours(hh, mm, 0, 0);
            return Date.now() > dispatchAt.getTime();
          })();

          return (
            <View key={row.id} style={styles.scheduleSection}>
              {/* Schedule header — cycle name (multi) + date + dispatch time */}
              <View style={styles.statusRow}>
                <View style={styles.scheduleHeadLeft}>
                  {isMulti && cycle?.cycle_name && (
                    <ThemedText variant="small" color="mint" style={styles.cycleLabel}>
                      {cycle.cycle_name}
                    </ThemedText>
                  )}
                  <ThemedText variant="body" color="subtitle">
                    {formatDateLong(row.dispatch_date)}
                  </ThemedText>
                </View>
                {cycle && !dispatchPassed && !rowCancelled && (
                  <ThemedText variant="small" color="mint" style={styles.dispatchScheduledLine}>
                    Dispatch by {dispatchTime}
                  </ThemedText>
                )}
              </View>

              {/* Status — timeline, or a Cancelled tag for an individually-cancelled row */}
              {rowCancelled ? (
                <View style={styles.rowCancelledTag}>
                  <ThemedText variant="small" style={styles.cancelledTitle}>
                    This delivery was cancelled
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.timeline}>
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
                          <View style={[styles.line, isCompleted && styles.lineCompleted]} />
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
                </View>
              )}

              {/* Items for this schedule */}
              <View style={styles.itemsBlock}>
                {(row.order_items ?? []).map((item) => (
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

              {row.status === 'Delivered' && (
                <TouchableOpacity
                  onPress={() => navigation.navigate('Feedback', { orderId: row.id })}
                  style={styles.reviewLink}
                >
                  <ThemedText variant="body" color="mint">Leave a Review ›</ThemedText>
                </TouchableOpacity>
              )}

              <Divider />
            </View>
          );
        })}

        {/* ── Shared totals (summed across the group) ──────────── */}
        <View style={styles.section}>
          <View style={styles.itemRow}>
            <ThemedText variant="body" color="subtitle">Subtotal</ThemedText>
            <ThemedText variant="body" color="subtitle">{formatPriceShort(groupSubtotal)}</ThemedText>
          </View>
          <View style={styles.itemRow}>
            <ThemedText variant="body" color="subtitle">Tax</ThemedText>
            <ThemedText variant="body" color="subtitle">{formatPriceShort(groupTax)}</ThemedText>
          </View>
          <View style={styles.itemRow}>
            <ThemedText variant="body" color="subtitle">Delivery</ThemedText>
            <ThemedText variant="body" color="subtitle">
              {groupDelivery === 0 ? 'Free' : formatPriceShort(groupDelivery)}
            </ThemedText>
          </View>
          <View style={[styles.itemRow, styles.totalRow]}>
            <ThemedText variant="subtitle" color="primary">Total</ThemedText>
            <ThemedText variant="subtitle" color="mint">{formatPriceShort(groupTotal)}</ThemedText>
          </View>
        </View>

        {/* Payment */}
        <Divider />
        <View style={styles.section}>
          <ThemedText variant="body" color="muted" style={styles.sectionLabel}>
            PAYMENT
          </ThemedText>
          <ThemedText variant="body" color="primary">
            {formatOrderStatus(groupRows[0].payment_method)}
          </ThemedText>
          {groupWallet > 0 && (
            <ThemedText variant="body" color="subtitle">
              Wallet: {formatPriceShort(groupWallet)}
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
  scheduleSection: { paddingTop: Theme.spacing.sm },
  scheduleHeadLeft: { flexDirection: 'column', flex: 1 },
  cycleLabel: { marginBottom: 2, letterSpacing: 0.5 },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  dispatchScheduledLine: {
    textAlign: 'right',
    marginTop: 2,
  },
  timeline: { paddingHorizontal: Theme.spacing.md },
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
  rowCancelledTag: {
    marginHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  itemsBlock: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
  },
  reviewLink: {
    marginTop: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
  },
  cancelBar: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
    alignItems: 'center',
    gap: 4,
  },
  cancelText: {
    color: Theme.colors.status.error,
    fontWeight: '600',
  },
  cancelHint: {
    textAlign: 'center',
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
