/**
 * 1stOne F1 — Admin Running Subscriptions Screen
 * Lists active subscriptions. Admin can cancel with prorated wallet refund.
 */

import React, { useState, useCallback } from 'react';
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
import { useAdminSubscriptions, useAdminCancelSubscription } from '../../hooks/useSubscriptions';
import { supabase } from '../../api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../../utils/constants';
import { formatDateShort } from '../../utils/formatters';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

function useWalletRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, amount, subId }: { userId: string; amount: number; subId: number }) => {
      if (amount <= 0) return;
      const { error } = await supabase.rpc('increment_wallet_balance', {
        p_user_id: userId,
        p_amount: amount,
        p_description: `Prorated refund — subscription #${subId} cancelled by admin`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
    },
  });
}

interface CancelTarget {
  id: number;
  user_id: string;
  customer: string;
  planName: string;
  daysRemaining: number;
  proratedAmount: number;
  paymentMethod: string;
}

export function AdminSubscriptionsScreen({ navigation }: any) {
  const { data: subs, isLoading, error, refetch } = useAdminSubscriptions();
  const { mutateAsync: cancelSub } = useAdminCancelSubscription();
  const { mutateAsync: refundWallet } = useWalletRefund();

  const [target, setTarget] = useState<CancelTarget | null>(null);
  const [refundStr, setRefundStr] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const openCancel = useCallback((sub: any) => {
    const plan = sub.subscription_plans ?? {};
    const daysTotal = plan.duration_days ?? 0;
    const daysConsumed = sub.days_consumed ?? 0;
    const daysRemaining = Math.max(0, daysTotal - daysConsumed);
    const planPrice = plan.price ?? 0;
    const prorated = daysTotal > 0
      ? Math.round((planPrice / daysTotal) * daysRemaining)
      : 0;

    setTarget({
      id: sub.id,
      user_id: sub.user_id,
      customer: sub.profiles?.full_name ?? sub.profiles?.phone_number ?? `User #${sub.user_id.slice(0, 8)}`,
      planName: plan.plan_name ?? `Plan #${sub.plan_id}`,
      daysRemaining,
      proratedAmount: prorated,
      paymentMethod: sub.payment_method ?? 'wallet',
    });
    setRefundStr(String(prorated));
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!target) return;
    const refundAmount = Number(refundStr) || 0;
    setIsSaving(true);
    try {
      await cancelSub({ subscriptionId: target.id });
      if (refundAmount > 0) {
        await refundWallet({ userId: target.user_id, amount: refundAmount, subId: target.id });
      }
      setTarget(null);
      Alert.alert(
        'Subscription Cancelled',
        refundAmount > 0
          ? `${target.customer}'s subscription cancelled.\n₹${refundAmount} credited to wallet.`
          : `${target.customer}'s subscription cancelled.`
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to cancel subscription');
    } finally {
      setIsSaving(false);
    }
  }, [target, refundStr, cancelSub, refundWallet]);

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

      {isLoading && (
        <ActivityIndicator color={Theme.colors.action.primary} style={{ marginTop: Theme.spacing.xl }} />
      )}

      <FlatList
        data={subs ?? []}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={!isLoading ? <EmptyState title="No active subscriptions" /> : null}
        ItemSeparatorComponent={() => <Divider />}
        renderItem={({ item }) => {
          const plan = item.subscription_plans ?? {};
          const daysTotal = plan.duration_days ?? 0;
          const daysRemaining = Math.max(0, daysTotal - (item.days_consumed ?? 0));
          const customer = item.profiles?.full_name ?? item.profiles?.phone_number ?? `User #${item.user_id.slice(0, 8)}`;
          return (
            <View style={styles.row}>
              <View style={styles.rowTop}>
                <ThemedText variant="body" color="primary" style={styles.txt}>{customer}</ThemedText>
                <TouchableOpacity onPress={() => openCancel(item)} activeOpacity={0.6}>
                  <ThemedText variant="small" style={styles.cancelText}>Cancel</ThemedText>
                </TouchableOpacity>
              </View>
              <View style={styles.rowBottom}>
                <ThemedText variant="small" color="subtitle" style={styles.sub}>
                  {plan.plan_name ?? `Plan #${item.plan_id}`}
                  {item.is_paused ? '  · Paused' : ''}
                </ThemedText>
                <ThemedText variant="small" color="muted" style={styles.sub}>
                  {daysRemaining} days left · from {formatDateShort(item.start_date)}
                </ThemedText>
              </View>
            </View>
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

            <ThemedText variant="body" color="subtitle" style={styles.modalLine}>
              {target?.customer}
            </ThemedText>
            <ThemedText variant="small" color="muted" style={styles.modalLine}>
              {target?.planName} · {target?.daysRemaining} days remaining
            </ThemedText>

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
  cancelText: { color: Theme.colors.status.error, fontWeight: '600', fontSize: S },
  txt: { fontSize: B },
  sub: { fontSize: S },

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
    fontWeight: '600',
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
    fontWeight: '600',
    fontSize: B,
  },
});
