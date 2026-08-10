/**
 * 1stOne F1 — Order Detail Screen
 *
 * MF-10: a customer "order" can span multiple delivery cycles. This screen
 * resolves the whole order group (via useOrderGroup) and renders ONE SECTION
 * PER DELIVERY — followed by one shared totals / payment block.
 * Cancellation acts on the whole group.
 *
 * A SECTION IS A DELIVERY, NOT A ROW. One checkout writes a row per (cycle,
 * type), so a single morning bag of idli and milk is two rows — and a section
 * per row gave the customer two trackers, two dates and two headings for one
 * bag arriving at one door, each reporting a status that was true of only
 * half of it. Rows sharing a purchase, a window and a day are one section
 * now, with ONE progress bar following the slower half and every order number
 * on the heading, because each id is real and staff search by it.
 */

import React, { useState, useCallback, useMemo } from 'react';
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
import { formatPriceShort, formatDateLong, getErrorMessage } from '../../utils/formatters';
import { formatTime12h } from '../../utils/timeEngine';
import { istDateStr, istDateWithOffset } from '../../utils/istDate';
import { isOperationalOrder } from '../../utils/orderFilters';
import {
  groupIntoDeliveries,
  rolledUpStatus,
  formatOrderNumbers,
} from '../../utils/orderDeliveries';
import { useReorder } from '../../hooks/useReorder';
import { useMySubscriptions } from '../../hooks/useSubscriptions';
import { subscriptionDaysRemaining } from '../../utils/subscriptionMath';

// Payment confirmed, kitchen not started — still cancellable. 'Paid' used to
// be in this set; the DB constraint dropped it in May 2026 and nothing writes
// it, so it matched no order and only implied a state that still existed.
const CANCELLABLE_STATUSES = new Set(['Pending', 'Confirmed', 'Preparing']);

// Progress bar flows — per blueprint Sec 5.1.
// Food shows the kitchen Ready step; Essentials skips it (no cooking).
// 'Preparing' is allowed by the DB constraint and the kitchen UI's
// "can act" check, but no code path actually writes it — the kitchen
// flips Confirmed → Ready in one tap (StaffDashboard.tsx:8). Dropping
// it from the customer timeline so the progress bar doesn't display
// a step the order never passes through.
// "Received at Hub" only appears when the order is going via a hub.
const FOOD_FLOW       = ['Confirmed', 'Ready', 'Packed', 'Dispatched', 'On the Way', 'Delivered'];
const ESSENTIALS_FLOW = ['Confirmed', 'Packed', 'Dispatched', 'On the Way', 'Delivered'];
// A plan PURCHASE delivers nothing — it is the revenue event that starts a
// subscription, and the meals arrive later as their own dispatch orders. It
// used to fall through to FOOD_FLOW and show the customer a kitchen-to-
// doorstep timeline for a row that will never move past Confirmed.
const PLAN_PURCHASE_FLOW = ['Confirmed'];

function buildStatusFlow(orderType: string | null | undefined, deliveryMethod: string | null | undefined): string[] {
  if (orderType === 'subscription') return PLAN_PURCHASE_FLOW;
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
  const { reorder, isWorking: isReordering } = useReorder();
  const { data: mySubs } = useMySubscriptions();

  // ── Group-level derived values (safe on empty — guarded before use) ──
  const groupRows: OrderWithItems[] = useMemo(() => rows ?? [], [rows]);
  // Sections are DELIVERIES. Subscription dispatches are kept — this screen
  // has to be able to open one — so no exclusion here, unlike My Orders.
  const deliveries = useMemo(() => groupIntoDeliveries(groupRows), [groupRows]);
  const primaryId = groupRows.length > 0 ? Math.min(...groupRows.map((r) => r.id)) : orderId;
  /** Every number in this purchase, for the page title. */
  const allIds = useMemo(() => groupRows.map((r) => r.id).sort((a, b) => a - b), [groupRows]);
  const allCancelled = groupRows.length > 0 && groupRows.every((r) => r.status === 'Cancelled');

  /**
   * A SUBSCRIPTION DISPATCH IS NOT A ₹0 ORDER.
   *
   * The meal was paid for when the plan was bought, so a dispatch row carries
   * zero money (BF-19). Printing that as "₹0" beside real food reads as an
   * error or a freebie — and a Breakfast-30 subscriber sees thirty of them a
   * month. Name the plan and the progress instead.
   */
  const subscriptionId = groupRows.find((r) => r.subscription_id != null)?.subscription_id ?? null;
  const planLabel = useMemo(() => {
    if (subscriptionId == null) return null;
    const sub = (mySubs ?? []).find((x: any) => x.id === subscriptionId) as any;
    if (!sub) return null;
    const plan = sub.subscription_plans ?? {};
    const total = plan.duration_days ?? 0;
    const name = plan.plan_name ?? 'Subscription';
    if (!total) return name;
    // Length is counted in MEALS, not calendar days — pausing and skipping
    // push the end date out — so this comes from the shared helper.
    const used = Math.max(1, Math.min(total, total - subscriptionDaysRemaining(plan, sub)));
    return `${name} · Day ${used} of ${total}`;
  }, [subscriptionId, mySubs]);

  // Reorder is about GOODS. A plan purchase is bought once and runs; a
  // dispatch is generated by the plan, not asked for by the customer.
  const canReorder =
    groupRows.length > 0 &&
    groupRows.every((r) => r.subscription_id == null) &&
    groupRows.some(isOperationalOrder);

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
    // nowIST is UTC-shifted by +5:30 so its getUTC* fields read as IST
    // wall-clock — used only for the minutes-of-day cutoff comparison below.
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(Date.now() + istOffsetMs);
    const todayISTStr    = istDateStr();
    const tomorrowISTStr = istDateWithOffset(1);
    const [cutH, cutM] = earliestCycle.cutoff_time.split(':').map(Number);
    const cutoffMins = cutH * 60 + cutM;
    const nowMins = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
    const isCrossMidnight = earliestCycle.cutoff_time > earliestCycle.delivery_start;
    const cutoffReached = nowMins >= cutoffMins;
    earliestCutoffPassed =
      (!isCrossMidnight && earliestRow.dispatch_date === todayISTStr    && cutoffReached) ||
      ( isCrossMidnight && earliestRow.dispatch_date === tomorrowISTStr && cutoffReached);
  }

  // G7 (UX): subscription-purchase orders aren't customer-cancellable —
  // cancel-order rejects them server-side, but the button was still
  // visible. Hide it client-side so a tap doesn't bounce the customer
  // off the "Cannot Cancel" alert. Subscription cancellation stays an
  // admin action (atomic deactivate + prorated refund). Reusing the
  // same isOperationalOrder predicate the staff/hub filters use
  // (BF-31) keeps the rule defined in one place.
  const hasOperationalRow = groupRows.some(isOperationalOrder);

  const canCancel =
    cancellableRows.length > 0 &&
    ageHours <= windowHours &&
    !earliestCutoffPassed &&
    !allCancelled &&
    hasOperationalRow;

  const handleReorder = useCallback(async () => {
    try {
      const res = await reorder(groupRows.map((r) => r.id));
      if (res.added === 0) {
        Alert.alert('Nothing to reorder', 'None of these items is available right now.');
        return;
      }
      if (res.dropped.length > 0) {
        Alert.alert(
          'Some items unavailable',
          `${res.dropped.join(', ')} ${res.dropped.length === 1 ? 'is' : 'are'} no longer available and ${res.dropped.length === 1 ? 'was' : 'were'} left out.`,
          [{ text: 'Go to cart', onPress: () => navigation.navigate('Cart') }],
        );
        return;
      }
      navigation.navigate('Cart');
    } catch {
      Alert.alert('Could not reorder', 'Please try again.');
    }
  }, [reorder, groupRows, navigation]);

  // Must be before early returns — Rules of Hooks
  const handleCancel = useCallback(() => {
    if (groupRows.length === 0) return;
    const razorpayDue = Math.max(0, groupTotal - groupWallet);
    const refundNote = groupWallet > 0
      ? `${formatPriceShort(groupWallet)} will be returned to your wallet instantly.${razorpayDue > 0 ? ` ${formatPriceShort(razorpayDue)} Razorpay refund will be processed by admin.` : ''}`
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
                msg = `${formatPriceShort(serverWallet)} returned to your wallet. ${formatPriceShort(serverRzp)} Razorpay refund will be processed within 5–7 business days.`;
              } else if (serverWallet > 0) {
                msg = `${formatPriceShort(serverWallet)} has been returned to your wallet.`;
              } else if (serverRzp > 0) {
                msg = `Your order has been cancelled. ${formatPriceShort(serverRzp)} Razorpay refund will be processed within 5–7 business days.`;
              }
              Alert.alert('Order Cancelled', msg);
            } catch (err) {
              Alert.alert('Cannot Cancel', getErrorMessage(err));
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

  // "Multi" now means more than one DELIVERY, which is what decides whether a
  // section needs a cycle name to tell it from its neighbour. Two rows in one
  // bag are one section and need no such label.
  const isMulti = deliveries.length > 1;
  // The status flow is per delivery — see inside the loop. It used to be
  // computed once from the first row's type, which was wrong the moment a
  // bag held both food and essentials.

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          {/* Every row number, not just the lowest — see the note at the
              top of this file. Capped by formatOrderNumbers so a long
              checkout cannot push the title off the screen. */}
          <ThemedText variant="header" color="primary" numberOfLines={1} style={styles.headerTitle}>
            {allIds.length > 1 ? 'Orders ' : 'Order '}{formatOrderNumbers(allIds)}
          </ThemedText>
          <View style={{ width: 40 }} />
        </View>

        {/* Cancelled banner — whole group cancelled */}
        {allCancelled && (
          <View style={styles.cancelledBanner}>
            <ThemedText variant="subtitle" style={styles.cancelledTitle}>Order Cancelled</ThemedText>
            {(() => {
              const r = Math.max(0, groupTotal - groupWallet);
              let line = '';
              if (groupWallet > 0 && r > 0) line = `${formatPriceShort(groupWallet)} returned to wallet · ${formatPriceShort(r)} Razorpay refund in 5–7 days`;
              else if (groupWallet > 0) line = `${formatPriceShort(groupWallet)} returned to your wallet`;
              else if (r > 0) line = `${formatPriceShort(r)} Razorpay refund will be processed in 5–7 business days`;
              return line ? (
                <ThemedText variant="small" color="muted" style={styles.cancelledRefund}>{line}</ThemedText>
              ) : null;
            })()}
          </View>
        )}

        {/* ── One section per DELIVERY ────────────────────────── */}
        {deliveries.map((delivery) => {
          const row = delivery.rows[0];           // the delivery's anchor row
          const cycle = (cycles ?? []).find((c) => c.id === delivery.cycleId);
          const dispatchTime = formatTime12h(cycle?.delivery_start);

          // ONE status for the bag: the least advanced row still running.
          // The milk is "Packed" off a shelf while the idli is still in the
          // kitchen, and the customer is waiting for both.
          const deliveryStatus = rolledUpStatus(delivery.rows);
          // The flow has to be the SUPERSET the bag actually travels. A bag
          // holding any food goes through the kitchen, so it shows Ready;
          // an essentials-only bag never does. Taking the first row's type
          // would have hidden the Ready step whenever the essentials row
          // happened to sort first.
          const statusFlow = buildStatusFlow(
            delivery.rows.some((r) => r.order_type === 'food') ? 'food' : row.order_type,
            row.delivery_method,
          );
          const currentStatusIndex = statusFlow.indexOf(deliveryStatus);
          const rowCancelled = deliveryStatus === 'Cancelled';

          // Money is summed across the bag — the delivery fee sits on
          // whichever row carried it, and the customer paid once. Pricing is
          // GST-inclusive (T1): tax sits INSIDE the item prices, so
          // subtotal = total − delivery, and tax is an informational note.
          const rowTax      = delivery.rows.reduce((t, r) => t + (Number(r.tax_amount) || 0), 0);
          const rowDelivery = delivery.rows.reduce((t, r) => t + (Number(r.delivery_fee) || 0), 0);
          const rowTotal    = delivery.totalAmount;
          const rowSubtotal = rowTotal - rowDelivery;

          // Hide the dispatch line once the dispatch window has passed.
          const dispatchPassed = (() => {
            if (!cycle?.delivery_start || !delivery.dispatchDate) return false;
            const [hh, mm] = cycle.delivery_start.split(':').map(Number);
            if (Number.isNaN(hh) || Number.isNaN(mm)) return false;
            const dispatchAt = new Date(delivery.dispatchDate);
            dispatchAt.setHours(hh, mm, 0, 0);
            return Date.now() > dispatchAt.getTime();
          })();

          return (
            <View key={delivery.key} style={styles.scheduleSection}>
              {/* Delivery header — cycle name (multi) + date, then the
                  dispatch line on its own row, right-aligned. */}
              <View style={styles.scheduleHeader}>
                {isMulti && cycle?.cycle_name && (
                  <ThemedText variant="small" color="mint" style={styles.cycleLabel}>
                    {cycle.cycle_name}
                  </ThemedText>
                )}
                {/* EVERY number in this bag. Each is real — staff search by
                    it, the driver reads it, it is on the printed slip — so
                    one of them was never enough to quote. */}
                {(isMulti || delivery.ids.length > 1) && (
                  <ThemedText variant="micro" color="muted" style={styles.rowId}>
                    {formatOrderNumbers(delivery.ids)}
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
              ) : deliveryStatus === 'Delivered' ? (
                <View style={styles.deliveredTag}>
                  <ThemedText variant="body" style={styles.deliveredText}>
                    ✓  Delivered
                  </ThemedText>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('Feedback', { orderId: delivery.primaryId })}
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

              {/* Invoice — items + this schedule's own money (per-row model).
                  A SUBSCRIPTION DISPATCH SHOWS NO MONEY AT ALL: it was paid
                  for at purchase, so prices here would all be ₹0 and read as
                  a mistake. It states which plan delivered it instead. */}
              <View style={styles.invoiceBlock}>
                {/* Every line in the bag, across its rows — the food and
                    the essentials arrive together and belong on one invoice. */}
                {delivery.rows.flatMap((r) => r.order_items ?? []).map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <ThemedText variant="body" color="primary">
                      {item.item_name} x{item.quantity}
                    </ThemedText>
                    {delivery.rows.every((r) => r.subscription_id == null) && (
                      <ThemedText variant="body" color="subtitle">
                        {formatPriceShort(item.price_at_time * item.quantity)}
                      </ThemedText>
                    )}
                  </View>
                ))}
                {delivery.rows.some((r) => r.subscription_id != null) ? (
                  <>
                    <View style={styles.invoiceRule} />
                    <ThemedText variant="body" color="mint">
                      {planLabel ?? 'Subscription delivery'}
                    </ThemedText>
                    <ThemedText variant="micro" color="muted" style={styles.gstNote}>
                      Already paid for with your plan
                    </ThemedText>
                  </>
                ) : (
                <>
                <View style={styles.invoiceRule} />
                <View style={styles.itemRow}>
                  <ThemedText variant="small" color="muted">Subtotal</ThemedText>
                  <ThemedText variant="small" color="subtitle">{formatPriceShort(rowSubtotal)}</ThemedText>
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
                {rowTax > 0 && (
                  <ThemedText variant="micro" color="muted" style={styles.gstNote}>
                    Incl. GST {formatPriceShort(rowTax)}
                  </ThemedText>
                )}
                </>
                )}
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

        {/* Payment — one line.
            'account' is a back-office order confirmed now and collected
            later; labelling it "Online" like every other non-wallet method
            would tell the customer an unpaid order was already paid. */}
        <View style={styles.section}>
          <ThemedText variant="body" color="subtitle">
            Payment · {
              groupRows[0].payment_method === 'wallet' ? 'Wallet'
                : groupRows[0].payment_method === 'account' ? 'To pay'
                : 'Online'
            } · {formatPriceShort(groupTotal)}
          </ThemedText>
        </View>

        {/* Cancel action — anchored to the bottom of the detail page so it
            sits after every line item / total / payment line and doesn't
            compete with the order summary at first glance. */}
        {/* Action row — Order again on the left, Cancel on the right.
            The two live together because they are the same question asked in
            opposite directions: do I want this again, or not at all.
            Reorder is offered whatever the status; cancelling stops being
            possible long before wanting it again does. */}
        {(canCancel || canReorder) && (
          <View style={styles.cancelBar}>
            <View style={styles.actionRow}>
              {canReorder ? (
                <TouchableOpacity
                  onPress={handleReorder}
                  activeOpacity={0.6}
                  disabled={isReordering}
                  accessibilityRole="button"
                  accessibilityLabel={`Order #${primaryId} again`}
                >
                  <ThemedText variant="body" color="mint">
                    {isReordering ? 'Adding…' : '↻ Order again'}
                  </ThemedText>
                </TouchableOpacity>
              ) : <View />}

              {canCancel && (isCancelling ? (
                <ActivityIndicator color={Theme.colors.status.error} size="small" />
              ) : (
                <TouchableOpacity onPress={handleCancel} activeOpacity={0.6}>
                  <ThemedText variant="body" style={styles.cancelText}>Cancel Order</ThemedText>
                </TouchableOpacity>
              ))}
            </View>
            {canCancel && (
            <ThemedText variant="micro" color="muted" style={styles.cancelHint}>
              {isMulti
                ? `Cancelling removes all ${groupRows.length} deliveries in this order`
                : earliestCycle
                  ? `Cancellable within ${windowHours}h of placing or before ${earliestCycle.cutoff_time.slice(0, 5)} cutoff`
                  : `Cancellable within ${windowHours}h of placing`}
            </ThemedText>
            )}
          </View>
        )}
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
  /** Two order numbers are wider than one — let the title take the slack
   *  between Back and the right spacer rather than pushing them apart. */
  headerTitle: { flex: 1, textAlign: 'center', marginHorizontal: Theme.spacing.sm },
  section: { padding: Theme.spacing.md },
  scheduleSection: { paddingTop: Theme.spacing.sm },
  scheduleHeader: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  cycleLabel: { marginBottom: 2, letterSpacing: 0.5 },
  rowId: { marginBottom: 2 },
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
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
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
  gstNote: { textAlign: 'right', marginTop: 4 },
});
