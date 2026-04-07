/**
 * 1stOne F1 — Plan Detail Screen
 *
 * Shows plan info, included items, price breakdown.
 * Subscribe button → calls Edge Function → payment if Razorpay.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  Alert,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import RazorpayCheckout from 'react-native-razorpay';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { Divider } from '../../components/Divider';
import { DispatchBadge } from '../../components/DispatchBadge';
import { useSubscriptionPlans, usePlanItems, useSubscribe } from '../../hooks/useSubscriptions';
import { useAuth } from '../../hooks/useAuth';
import { useUIStore } from '../../store/uiStore';
import { formatPriceShort } from '../../utils/formatters';
import { RAZORPAY_KEY_ID } from '../../utils/env';

export function PlanDetailScreen({ route, navigation }: any) {
  const { planId } = route.params;
  const { session } = useAuth();
  const setGlobalLoading = useUIStore((s) => s.setGlobalLoading);

  const { data: plans } = useSubscriptionPlans();
  const plan = plans?.find((p) => p.id === planId);
  const { data: planItems } = usePlanItems(planId);
  const { mutateAsync: subscribe } = useSubscribe();

  const [paymentMethod, setPaymentMethod] = useState<'razorpay' | 'wallet'>('razorpay');
  const [isSubscribing, setIsSubscribing] = useState(false);

  const handleSubscribe = useCallback(async () => {
    if (!plan) return;

    setIsSubscribing(true);
    setGlobalLoading(true, 'Setting up subscription...');

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 1); // Start tomorrow
      const startDateStr = startDate.toISOString().split('T')[0];

      const result = await subscribe({
        plan_id: plan.id,
        payment_method: paymentMethod,
        start_date: startDateStr,
      });

      // If Razorpay payment needed
      if (paymentMethod === 'razorpay' && result?.razorpay_order_id) {
        try {
          await RazorpayCheckout.open({
            description: `1stOne ${plan.plan_name} Subscription`,
            currency: 'INR',
            key: RAZORPAY_KEY_ID,
            amount: Math.round(plan.price * 100),
            order_id: result.razorpay_order_id,
            name: '1stOne',
            prefill: { contact: session?.user.phone ?? '' },
            theme: { color: Theme.colors.action.primary },
          });
        } catch {
          Alert.alert('Payment Cancelled', 'You can retry from My Subscriptions.');
        }
      }

      setGlobalLoading(false);
      Alert.alert('Subscribed!', `${plan.plan_name} starts tomorrow.`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to subscribe');
    } finally {
      setIsSubscribing(false);
      setGlobalLoading(false);
    }
  }, [plan, paymentMethod, subscribe, session, navigation, setGlobalLoading]);

  if (!plan) {
    return (
      <SafeAreaView style={styles.container}>
        <ThemedText variant="body" color="subtitle" style={styles.loading}>
          Loading...
        </ThemedText>
      </SafeAreaView>
    );
  }

  const pricePerDay = plan.price / plan.duration_days;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">Plan Details</ThemedText>
          <View style={{ width: 40 }} />
        </View>

        {/* Plan Info */}
        <View style={styles.section}>
          <ThemedText variant="title" color="primary">
            {plan.plan_name}
          </ThemedText>
          <View style={styles.metaRow}>
            <ThemedText variant="body" color="subtitle">
              {plan.duration_days} days
            </ThemedText>
            {plan.savings_amount > 0 && (
              <DispatchBadge
                label={`Save ${formatPriceShort(plan.savings_amount)}`}
                variant="success"
              />
            )}
          </View>

          <View style={styles.priceBlock}>
            <ThemedText variant="title" color="accent">
              {formatPriceShort(plan.price)}
            </ThemedText>
            <ThemedText variant="small" color="muted">
              {formatPriceShort(pricePerDay)} per day
            </ThemedText>
          </View>
        </View>

        <Divider />

        {/* Included Items */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            INCLUDED ITEMS
          </ThemedText>
          {(planItems ?? []).map((pi: any) => (
            <View key={pi.id} style={styles.itemRow}>
              <ThemedText variant="body" color="primary">
                {pi.menu_items?.name ?? `Item #${pi.item_id}`}
              </ThemedText>
              <ThemedText variant="small" color="subtitle">
                x{pi.quantity}
              </ThemedText>
            </View>
          ))}
          {(!planItems || planItems.length === 0) && (
            <ThemedText variant="small" color="muted">
              Items will be assigned daily based on the cycle menu
            </ThemedText>
          )}
        </View>

        <Divider />

        {/* Payment Choice */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            PAYMENT
          </ThemedText>
          <TouchableOpacity
            style={[
              styles.payOpt,
              paymentMethod === 'razorpay' && styles.payOptSelected,
            ]}
            onPress={() => setPaymentMethod('razorpay')}
          >
            <ThemedText variant="body" color="primary">
              Pay Online (Razorpay)
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.payOpt,
              paymentMethod === 'wallet' && styles.payOptSelected,
            ]}
            onPress={() => setPaymentMethod('wallet')}
          >
            <ThemedText variant="body" color="primary">
              Wallet Balance
            </ThemedText>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Subscribe Button */}
      <View style={styles.footer}>
        <ThemedButton
          title={`Subscribe · ${formatPriceShort(plan.price)}`}
          onPress={handleSubscribe}
          loading={isSubscribing}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  content: {
    paddingBottom: 100,
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  priceBlock: {
    marginTop: Theme.spacing.md,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  payOpt: {
    backgroundColor: Theme.colors.background.card,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  payOptSelected: {
    borderColor: Theme.colors.action.primary,
  },
  footer: {
    padding: Theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.layout.divider,
    backgroundColor: Theme.colors.background.card,
  },
});
