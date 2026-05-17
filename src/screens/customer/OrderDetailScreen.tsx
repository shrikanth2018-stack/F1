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
import { formatPriceShort, formatDateLong } from '../../utils/formatters';
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

  const groupTotal  = groupRows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
  const groupWallet = groupRows.reduce((s, r) => s + (Number(r.wallet_amount_used) || 0), 0);

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

          // Per-schedule invoice figures — per-row money model: each row is
          // self-describing.
          const rowTax      = Number(row.tax_amount) || 0;
          const rowDelivery = Number(row.delivery_fee) || 0;
          const rowTotal    = Number(row.total_amount) || 0;
          const rowSubtotal = rowTotal - rowTax - rowDelivery;

          // Hide the dispatch line once the dispatch window has passed.
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
              {/* Schedule header — cycle name (multi) + date, then the
                  dispatch line on its own row, right-aligned. */}
              <View style={styles.scheduleHeader}>
                {isMulti && cycle?.cycle_name && (
                  <ThemedText variant="small" color="mint" style={styles.cycleLabel}>
                    {cycle.cycle_name}
                  </ThemedText>
                )}
                <ThemedText variant="body" color="subtitle">
                  {formatDateLong(row.dispatch_date)}
                </ThemedText>
                {cycle && !dispatchPassed && !rowCancelled && (
                  <ThemedText variant="small" color="mint" style={styles.dispatchLine}>
                    Dispatch scheduled at {dispatchTime}
                  </ThemedText>
                )}
              </View>

              {/* Status — vertical timeline; collapses to a ✓ line once
                  delivered; a Cancelled tag for an individually-cancelled row. */}
              {rowCancelled ? (
                <View style={styles.rowCancelledTag}>
                  <ThemedText variant="small" style={styles.cancelledTitle}>
                    This delivery was cancelled
                  </ThemedText>
                </View>
              ) : row.status === 'Delivered' ? (
                <View style={styles.deliveredTag}>
                  <ThemedText variant="body" style={styles.deliveredText}>
                    ✓  Delivered
                  </ThemedText>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('Feedback', { orderId: row.id })}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <ThemedText variant="body" color="mint">Leave a Review ›</ThemedText>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.timeline}>
                  {statusFlow.map((status, index) => {
                    const isDone = index < currentStatusIndex;
                    const isCurrent = index === currentStatusIndex;
                    const isFuture = index > currentStatusIndex;
                    return (
                      <View key={status} style={styles.timelineRow}>
                        {/* Rail: a continuous vector line, green from the top
                            down to the current dot. Two half-segments per row
                            abut the next so the line reads as one stroke. */}
                        <View style={styles.rail}>
                          {index > 0 && (
                            <View style={[styles.lineUp, index <= currentStatusIndex && styles.lineDone]} />
                          )}
                          {index < statusFlow.length - 1 && (
                            <View style={[styles.lineDown, index < currentStatusIndex && styles.lineDone]} />
                          )}
                          <View style={[styles.dot, isDone && styles.dotDone, isCurrent && styles.dotCurrent]} />
                        </View>
                        <ThemedText
                          variant="body"
                          color={isCurrent ? 'primary' : isFuture ? 'muted' : 'subtitle'}
                          style={isCurrent ? styles.stepCurrent : styles.stepRest}
                        >
                          {status}
                        </ThemedText>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Separator — splits the tracker from the invoice */}
              <Divider />

              {/* Invoice — items + this schedule's own money (per-row model) */}
              <View style={styles.invoiceBlock}>
                {(row.order_items ?? []).map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <ThemedText variant="body" color="primary">
                      {item.item_name} x{item.quantity}
                    </ThemedText>
                    <ThemedText variant="body" color="subtitle">
                      {formatPriceShort(item.price_at_time * item.quantity)}
                    </ThemedText>
                  </View>
                ))}
                <View style={styles.invoiceRule} />
                <View style={styles.itemRow}>
                  <ThemedText variant="small" color="muted">Subtotal</ThemedText>
                  <ThemedText variant="small" color="subtitle">{formatPriceShort(rowSubtotal)}</ThemedText>
                </View>
                <View style={styles.itemRow}>
                  <ThemedText variant="small" color="muted">Tax</ThemedText>
                  <ThemedText variant="small" color="subtitle">{formatPriceShort(rowTax)}</ThemedText>
                </View>
                <View style={styles.itemRow}>
                  <ThemedText variant="small" color="muted">Delivery</ThemedText>
                  <ThemedText variant="small" color="subtitle">
                    {rowDelivery === 0 ? 'Free' : formatPriceShort(rowDelivery)}
                  </ThemedText>
                </View>
                <View style={[styles.itemRow, styles.totalRow]}>
                  <ThemedText variant="body" color="primary">Total</ThemedText>
                  <ThemedText variant="body" color="mint">{formatPriceShort(rowTotal)}</ThemedText>
                </View>
              </View>

              <Divider />
            </View>
          );
        })}

        {/* Order total — only when the order spans multiple schedules */}
        {isMulti && (
          <View style={styles.section}>
            <View style={[styles.itemRow, styles.totalRow]}>
              <ThemedText variant="subtitle" color="primary">Order total</ThemedText>
              <ThemedText variant="subtitle" color="mint">{formatPriceShort(groupTotal)}</ThemedText>
            </View>
          </View>
        )}

        {/* Payment — one line */}
        <View style={styles.section}>
          <ThemedText variant="body" color="subtitle">
            Payment · {groupRows[0].payment_method === 'wallet' ? 'Wallet' : 'Online'} · {formatPriceShort(groupTotal)}
          </ThemedText>
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
  scheduleSection: { paddingTop: Theme.spacing.sm },
  scheduleHeader: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  cycleLabel: { marginBottom: 2, letterSpacing: 0.5 },
  dispatchLine: {
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  timeline: { paddingHorizontal: Theme.spacing.md, paddingVertical: 2 },
  // Minimal, fixed row height — keeps the connecting line continuous and tight.
  timelineRow: { flexDirection: 'row', alignItems: 'center', height: 26 },
  rail: { width: 14, height: '100%', alignItems: 'center', justifyContent: 'center' },
  // Two half-segments per row (top + bottom of the dot). Consecutive rows abut,
  // so the rail reads as one thin vector stroke.
  lineUp: {
    position: 'absolute',
    left: 6.25,
    top: 0,
    width: 1.5,
    height: '50%',
    backgroundColor: Theme.colors.background.input,
  },
  lineDown: {
    position: 'absolute',
    left: 6.25,
    top: '50%',
    width: 1.5,
    height: '50%',
    backgroundColor: Theme.colors.background.input,
  },
  lineDone: { backgroundColor: Theme.colors.status.success },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Theme.colors.background.input,
  },
  dotDone: { backgroundColor: Theme.colors.status.success },
  dotCurrent: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Theme.colors.action.primary,
  },
  // Current stage stands out (+2pt, bold); the rest are quieter (−2pt).
  stepCurrent: {
    marginLeft: Theme.spacing.xs,
    fontSize: Theme.typography.sizes.body + 2,
  },
  stepRest: {
    marginLeft: Theme.spacing.xs,
    fontSize: Theme.typography.sizes.body - 2,
  },
  deliveredTag: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
  },
  deliveredText: {
    color: Theme.colors.status.success,
  },
  rowCancelledTag: {
    marginHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  invoiceBlock: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
  },
  invoiceRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
    marginVertical: Theme.spacing.sm,
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
