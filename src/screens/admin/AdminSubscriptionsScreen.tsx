/**
 * 1stOne F1 — Admin Running Subscriptions Screen
 *
 * Lists active subscriptions (is_active=true) — paused subs included.
 * Admin can cancel with prorated wallet refund.
 *
 * Filters in-place:
 *   - Period (start_date within Weekly / Monthly / Quarterly / Custom range)
 *   - Status (All / Active / Paused — status is a property of an active sub)
 *
 * Row tap opens the cancel modal with a read-only detail block above the
 * refund input so the admin sees lifecycle state (start date, days
 * consumed vs total, payment method) before confirming.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import {
  ReportPeriodPicker,
  defaultCustomRange,
  getPeriodRange,
  type Period,
  type DateRange,
} from '../../components/ReportPeriodPicker';
import { useAdminSubscriptions, useAdminCancelSubscription } from '../../hooks/useSubscriptions';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { formatDateShort, getErrorMessage } from '../../utils/formatters';
import {
  subscriptionDaysRemaining,
  proratedSubscriptionRefund,
} from '../../utils/subscriptionMath';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

// BF-20 (D-03b, 2026-05-04): the previous local useWalletRefund mini-hook
// (which separately invoked increment_wallet_balance after deactivation)
// was retired. The atomic admin_cancel_subscription_atomic RPC now does
// deactivate + wallet credit in one Postgres transaction.

type StatusFilter = 'All' | 'Active' | 'Paused';
const STATUS_FILTERS: StatusFilter[] = ['All', 'Active', 'Paused'];

interface CancelTarget {
  id: number;
  user_id: string;
  customer: string;
  customerPhone: string;
  planName: string;
  planPrice: number;
  durationDays: number;
  daysConsumed: number;
  daysRemaining: number;
  startDate: string;
  paymentMethod: string;
  proratedAmount: number;
}

export function AdminSubscriptionsScreen({ navigation }: any) {
  const { data: subs, isLoading, error, refetch } = useAdminSubscriptions();
  const { mutateAsync: cancelSub } = useAdminCancelSubscription();
  const { data: storeConfig } = useStoreConfig();

  // ── Filters ─────────────────────────────────────────────
  const [period, setPeriod] = useState<Period>('Monthly');
  const [customRange, setCustomRange] = useState<DateRange>(defaultCustomRange());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const { start, end } = useMemo(
    () => getPeriodRange(period, customRange),
    [period, customRange],
  );

  const filtered = useMemo(() => {
    const all = subs ?? [];
    return all.filter((s) => {
      // status
      if (statusFilter === 'Active' && s.is_paused) return false;
      if (statusFilter === 'Paused' && !s.is_paused) return false;
      // period (start_date inclusive bounds)
      if (s.start_date) {
        const sd = String(s.start_date).slice(0, 10);
        if (sd < start || sd > end) return false;
      }
      return true;
    });
  }, [subs, statusFilter, start, end]);

  const counts = useMemo(() => {
    const all = subs ?? [];
    return {
      all: all.length,
      active: all.filter((s) => !s.is_paused).length,
      paused: all.filter((s) => s.is_paused).length,
    };
  }, [subs]);

  // ── Cancel modal ────────────────────────────────────────
  const [target, setTarget] = useState<CancelTarget | null>(null);
  const [refundStr, setRefundStr] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const openCancel = useCallback((sub: any) => {
    const plan = sub.subscription_plans ?? {};
    const daysRemaining = subscriptionDaysRemaining(plan, sub);

    // BF-21 (D-03a): proration is on the all-inclusive figure the customer
    // paid — the GST-inclusive plan price plus the delivery fee (T1: tax is
    // already inside the price, never added on). Math lives in
    // src/utils/subscriptionMath. The admin can override before confirming.
    const deliveryFee = storeConfig?.delivery_fee ?? 0;
    const prorated = proratedSubscriptionRefund(plan, sub, deliveryFee);

    setTarget({
      id: sub.id,
      user_id: sub.user_id,
      customer: sub.profiles?.full_name ?? sub.profiles?.phone_number ?? `User #${sub.user_id.slice(0, 8)}`,
      customerPhone: sub.profiles?.phone_number ?? '',
      planName: plan.plan_name ?? `Plan #${sub.plan_id}`,
      planPrice: plan.price ?? 0,
      durationDays: plan.duration_days ?? 0,
      daysConsumed: sub.days_consumed ?? 0,
      daysRemaining,
      startDate: sub.start_date,
      paymentMethod: sub.payment_method ?? 'wallet',
      proratedAmount: prorated,
    });
    setRefundStr(String(prorated));
  }, [storeConfig]);

  const handleConfirm = useCallback(async () => {
    if (!target) return;
    const refundAmount = Number(refundStr) || 0;
    setIsSaving(true);
    try {
      // BF-20: single atomic call. Deactivates + credits wallet in one
      // Postgres transaction. If refundAmount = 0, just deactivates.
      await cancelSub({ subscriptionId: target.id, refundAmount });
      setTarget(null);
      Alert.alert(
        'Subscription Cancelled',
        refundAmount > 0
          ? `${target.customer}'s subscription cancelled.\n₹${refundAmount} credited to wallet.`
          : `${target.customer}'s subscription cancelled.`,
      );
    } catch (e) {
      Alert.alert('Error', getErrorMessage(e));
    } finally {
      setIsSaving(false);
    }
  }, [target, refundStr, cancelSub]);

  if (error) return <ErrorRetry message="Could not load subscriptions" onRetry={refetch} />;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Running Subscriptions</ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      <ReportPeriodPicker
        period={period}
        customRange={customRange}
        onChangePeriod={setPeriod}
        onChangeCustomRange={setCustomRange}
      />

      {/* Status filter */}
      <View style={styles.statusRow}>
        {STATUS_FILTERS.map((f, i) => {
          const count = f === 'All' ? counts.all : f === 'Active' ? counts.active : counts.paused;
          const active = statusFilter === f;
          return (
            <React.Fragment key={f}>
              {i > 0 && <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>}
              <TouchableOpacity onPress={() => setStatusFilter(f)}>
                <ThemedText
                  variant="body"
                  color={active ? 'primary' : 'muted'}
                  style={[styles.txt, active && styles.activeTxt]}
                >
                  {f} · {count}
                </ThemedText>
              </TouchableOpacity>
            </React.Fragment>
          );
        })}
      </View>

      {isLoading && (
        <ActivityIndicator color={Theme.colors.action.primary} style={{ marginTop: Theme.spacing.xl }} />
      )}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={!isLoading ? <EmptyState title="No subscriptions in this view" /> : null}
        ItemSeparatorComponent={() => <Divider />}
        renderItem={({ item }) => {
          const plan = item.subscription_plans ?? {};
          const daysConsumed = item.days_consumed ?? 0;
          const total = plan.duration_days ?? 0;
          const daysRemaining = subscriptionDaysRemaining(plan, item);
          const customer = item.profiles?.full_name ?? item.profiles?.phone_number ?? `User #${item.user_id.slice(0, 8)}`;
          const pmLabel = (item.payment_method ?? 'wallet') === 'wallet' ? 'Wallet' : 'Online';
          return (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.6}
              onPress={() => openCancel(item)}
            >
              <View style={styles.rowTop}>
                <ThemedText variant="body" color="primary" style={styles.txt}>{customer}</ThemedText>
                <ThemedText variant="small" color="muted" style={styles.sub}>
                  {daysConsumed}/{total} consumed
                </ThemedText>
              </View>
              <View style={styles.rowBottom}>
                <ThemedText variant="small" color="subtitle" style={styles.sub}>
                  {plan.plan_name ?? `Plan #${item.plan_id}`}
                  {item.is_paused ? '  · Paused' : ''}
                </ThemedText>
                <ThemedText variant="small" color="muted" style={styles.sub}>
                  {daysRemaining} left · {pmLabel}
                </ThemedText>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* Cancel + Refund Modal */}
      <Modal visible={!!target} transparent animationType="fade" onRequestClose={() => setTarget(null)}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalBox}>
            <ThemedText variant="subtitle" color="primary" style={styles.modalTitle}>
              Cancel Subscription
            </ThemedText>

            {/* Detail block — read-only summary so admin sees lifecycle state */}
            <ThemedText variant="body" color="primary" style={styles.modalLine}>
              {target?.customer}
            </ThemedText>
            {target?.customerPhone ? (
              <ThemedText variant="small" color="muted" style={styles.modalLine}>
                {target.customerPhone}
              </ThemedText>
            ) : null}

            <View style={styles.detailGrid}>
              <View style={styles.detailRow}>
                <ThemedText variant="small" color="muted" style={styles.detailLabel}>Plan</ThemedText>
                <ThemedText variant="small" color="subtitle" style={styles.detailValue}>
                  {target?.planName} · ₹{target?.planPrice} / {target?.durationDays}d
                </ThemedText>
              </View>
              <View style={styles.detailRow}>
                <ThemedText variant="small" color="muted" style={styles.detailLabel}>Started</ThemedText>
                <ThemedText variant="small" color="subtitle" style={styles.detailValue}>
                  {target ? formatDateShort(target.startDate) : ''}
                </ThemedText>
              </View>
              <View style={styles.detailRow}>
                <ThemedText variant="small" color="muted" style={styles.detailLabel}>Consumed</ThemedText>
                <ThemedText variant="small" color="subtitle" style={styles.detailValue}>
                  {target?.daysConsumed}/{target?.durationDays} · {target?.daysRemaining} remaining
                </ThemedText>
              </View>
              <View style={styles.detailRow}>
                <ThemedText variant="small" color="muted" style={styles.detailLabel}>Paid via</ThemedText>
                <ThemedText variant="small" color="subtitle" style={styles.detailValue}>
                  {target?.paymentMethod === 'wallet' ? 'Wallet' : (target?.paymentMethod ?? 'wallet')}
                </ThemedText>
              </View>
            </View>

            <Divider />

            <ThemedText variant="small" color="muted" style={styles.modalLabel}>
              WALLET REFUND (₹) — edit if needed
            </ThemedText>
            <TextInput
              style={styles.input}
              value={refundStr}
              onChangeText={setRefundStr}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={Theme.colors.text.muted}
            />

            {target?.paymentMethod !== 'wallet' && Number(refundStr) > 0 && (
              <ThemedText variant="micro" color="muted" style={styles.modalNote}>
                Paid via {target?.paymentMethod}. Refund will be credited to wallet by admin decision.
              </ThemedText>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setTarget(null)} style={styles.modalBtn} activeOpacity={0.7}>
                <ThemedText variant="body" color="muted" style={styles.txt}>Back</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirm}
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                disabled={isSaving}
                activeOpacity={0.75}
              >
                {isSaving
                  ? <ActivityIndicator color={Theme.colors.status.error} />
                  : <ThemedText variant="body" style={styles.confirmText}>Cancel & Refund</ThemedText>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  txt: { fontSize: B },
  sub: { fontSize: S },
  activeTxt: {  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: Theme.colors.layout.overlay,
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.lg,
  },
  modalBox: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius + 4,
    padding: Theme.spacing.lg,
  },
  modalTitle: {
    textAlign: 'center',
    marginBottom: Theme.spacing.md,
    fontSize: B + 2,
  },
  modalLine: {
    marginBottom: Theme.spacing.xs,
    fontSize: B,
  },
  detailGrid: {
    marginTop: Theme.spacing.xs,
    marginBottom: Theme.spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  detailLabel: { fontSize: S, letterSpacing: 0.5 },
  detailValue: { fontSize: S, textAlign: 'right', flex: 1, marginLeft: Theme.spacing.sm },
  modalLabel: {
    letterSpacing: 0.8,
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.xs,
    fontSize: S,
  },
  input: {
    backgroundColor: Theme.colors.background.input,
    color: Theme.colors.text.primary,
    borderRadius: Theme.components.inputRadius,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    fontSize: B + 4,
    textAlign: 'right',
    marginBottom: Theme.spacing.xs,
  },
  modalNote: {
    fontSize: S - 1,
    marginBottom: Theme.spacing.xs,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Theme.spacing.md,
  },
  modalBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm + 2,
  },
  modalBtnConfirm: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: Theme.colors.layout.divider,
  },
  confirmText: {
    color: Theme.colors.status.error,
    fontSize: B,
  },
});
