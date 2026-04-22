/**
 * 1stOne F1 — Plan Detail Screen
 *
 * Shows plan info, included items, price breakdown.
 * Subscribe button → calls Edge Function → payment if Razorpay.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  Alert,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Text,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import RazorpayCheckout from '../../utils/razorpay';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { useSubscriptionPlans, usePlanItems, useSubscribe, useConfirmSubscription, useMySubscriptions } from '../../hooks/useSubscriptions';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useAuth } from '../../hooks/useAuth';
import { useUIStore } from '../../store/uiStore';
import { formatPriceShort, formatDateShort } from '../../utils/formatters';
import { formatTime12h } from '../../utils/timeEngine';
import { RAZORPAY_KEY_ID } from '../../utils/env';
import { trackPlanViewed, trackSubscribed } from '../../utils/analytics';

/** Next N calendar days starting from tomorrow */
function getSelectableDates(count = 14): Date[] {
  const dates: Date[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function PlanDetailScreen({ route, navigation }: any) {
  const { planId } = route.params;
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const setGlobalLoading = useUIStore((s) => s.setGlobalLoading);

  const { data: plans } = useSubscriptionPlans();
  const plan = plans?.find((p) => p.id === planId);
  const { data: planItems } = usePlanItems(planId);
  const { data: cycles } = useDeliveryCycles();
  const cycle = cycles?.find((c) => c.id === plan?.cycle_id);
  const { mutateAsync: subscribe } = useSubscribe();
  const { mutateAsync: confirmSubscription } = useConfirmSubscription();
  const { data: mySubs } = useMySubscriptions();

  // Track plan view once plan data is loaded
  React.useEffect(() => {
    if (plan) trackPlanViewed(plan.id, plan.plan_name, plan.price);
  }, [plan?.id]);

  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }, []);

  const selectableDates = useMemo(() => getSelectableDates(14), []);
  const [startDate, setStartDate] = useState<Date>(tomorrow);
  const [paymentMethod, setPaymentMethod] = useState<'razorpay' | 'wallet'>('razorpay');
  const [isSubscribing, setIsSubscribing] = useState(false);

  /**
   * Conflict: another active sub with the same cycle_id AND same plan_type
   * (food vs essential). Multiple cycles on same day = fine. Food + Essentials
   * on same cycle = fine. Same type on same cycle = blocked.
   */
  const conflictingSubs = useMemo(() => {
    if (!plan || !mySubs) return [];
    // Treat null plan_type (legacy rows created before the column existed) as 'food'
    const newType = plan.plan_type ?? 'food';
    return (mySubs as any[]).filter(
      (s) =>
        s.is_active &&
        s.subscription_plans?.cycle_id === plan.cycle_id &&
        (s.subscription_plans?.plan_type ?? 'food') === newType
    );
  }, [plan, mySubs]);

  const doSubscribe = useCallback(async (overrideStartDate: Date) => {
    if (!plan) {
      console.error('[doSubscribe] Aborted — plan is null');
      return;
    }
    setIsSubscribing(true);
    setGlobalLoading(true, 'Setting up subscription...');
    try {
      const startDateStr = overrideStartDate.toISOString().split('T')[0];

      const result = await subscribe({
        plan_id: plan.id,
        payment_method: paymentMethod,
        start_date: startDateStr,
      });

      if (paymentMethod === 'razorpay' && (result as any)?.razorpay_order_id) {
        if (!RAZORPAY_KEY_ID) {
          console.error('[doSubscribe] RAZORPAY_KEY_ID is empty — check EXPO_PUBLIC_RAZORPAY_KEY_ID in .env');
          Alert.alert('Configuration Error', 'Payment gateway not configured. Please contact support.');
          return;
        }

        // iOS SDK requires exactly 10-digit contact; strip country prefix if present
        const rawPhone = session?.user.phone ?? '';
        const contact = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;

        const rzpOptions = {
          description: `1stOne ${plan.plan_name} Subscription`,
          currency: 'INR',
          key: RAZORPAY_KEY_ID,
          // amount must be an integer (paise); SDK rejects floats silently on iOS
          amount: Math.round(plan.price * 100),
          order_id: (result as any).razorpay_order_id,
          name: '1stOne',
          prefill: {
            // iOS SDK requires a non-empty email string or it won't render the sheet
            email: 'customer@1stone.in',
            contact,
          },
          // Must be a 6-char hex; Theme token resolves to one, but be explicit
          theme: { color: Theme.colors.action.primary },
        };

        let rzpResult: any;
        try {
          // The native shim (razorpay.native.ts) already waits for InteractionManager
          // + 150 ms so the react-native-screens UIViewController is committed.
          // Race adds a hard ceiling for cases where the SDK hangs post-open.
          rzpResult = await Promise.race([
            RazorpayCheckout.open(rzpOptions),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Payment sheet timed out. Please try again.')), 30_000)
            ),
          ]);
        } catch (rpErr: any) {
          if (rpErr?.message?.includes('timed out')) {
            Alert.alert('Payment Timeout', 'The payment sheet did not open. Please try again.');
          } else {
            Alert.alert('Payment Cancelled', 'You can retry from My Subscriptions.');
          }
          return;
        }

        // Client-side signature verification — activates the subscription immediately
        // without needing the Razorpay webhook (which requires a live dashboard).
        // In production both paths run; whichever fires first wins.
        let paymentConfirmed = false;
        if (rzpResult?.razorpay_payment_id && rzpResult?.razorpay_signature) {
          try {
            setGlobalLoading(true, 'Confirming payment...');
            await confirmSubscription({
              subscription_id: (result as any).subscription_id,
              razorpay_payment_id: rzpResult.razorpay_payment_id,
              razorpay_order_id: rzpResult.razorpay_order_id,
              razorpay_signature: rzpResult.razorpay_signature,
            });
            paymentConfirmed = true;
          } catch {
            // Non-fatal — webhook will activate it within a few seconds
          }
        }

        if (!paymentConfirmed) {
          Alert.alert(
            'Payment Received',
            'Your payment was captured. Subscription activation may take a moment — check My Subscriptions shortly.',
            [{ text: 'OK', onPress: () => navigation.navigate('Subscriptions') }],
          );
          return;
        }
      }

      trackSubscribed(plan.id, plan.plan_name, paymentMethod);
      const itemNames = (planItems ?? [])
        .map((pi: any) => pi.menu_items?.name)
        .filter(Boolean)
        .join(', ');
      Alert.alert(
        'Subscribed!',
        `${plan.plan_name}${itemNames ? `\nDelivers: ${itemNames}` : ''}\n\nStarts: ${formatDateShort(startDateStr)}\nDuration: ${plan.duration_days} days\n\nManage from My Subscriptions in your profile.`,
        [{ text: 'View My Subscriptions', onPress: () => navigation.navigate('Subscriptions') }],
      );
    } catch (err: any) {
      console.error('[doSubscribe] Caught error:', err?.message, err);
      Alert.alert('Subscription Failed', err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubscribing(false);
      setGlobalLoading(false);
    }
  }, [plan, paymentMethod, subscribe, session, navigation, setGlobalLoading]);

  const handleSubscribe = useCallback(() => {
    if (!plan) return;

    if (conflictingSubs.length > 0) {
      const existing = conflictingSubs[0];
      const existingPlanName = existing.subscription_plans?.plan_name ?? 'existing plan';
      const duration = existing.subscription_plans?.duration_days ?? 0;
      // Day after last delivery of the existing sub
      const afterDate = new Date(existing.start_date);
      afterDate.setDate(afterDate.getDate() + duration);

      Alert.alert(
        'Subscription Conflict',
        `You already have "${existingPlanName}" active on this cycle. You can schedule this plan to start after it ends.`,
        [
          {
            text: `Start After (${formatDateShort(afterDate.toISOString().split('T')[0])})`,
            onPress: () => doSubscribe(afterDate),
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    doSubscribe(startDate);
  }, [plan, conflictingSubs, startDate, doSubscribe]);

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
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}>
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
          <ThemedText variant="body" color="subtitle" style={styles.planDesc}>
            {cycle ? `${cycle.cycle_name} daily for ${plan.duration_days} days` : `${plan.duration_days} days`}
          </ThemedText>
          {cycle && (
            <ThemedText variant="body" color="subtitle" style={styles.planDesc}>
              {`Dispatching daily by : ${formatTime12h(cycle.delivery_start)}`}
            </ThemedText>
          )}

          <View style={styles.priceBlock}>
            <ThemedText variant="title" color="mint">
              {formatPriceShort(plan.price)}
            </ThemedText>
            <ThemedText variant="small" color="muted">
              {formatPriceShort(pricePerDay)} per day
            </ThemedText>
          </View>
        </View>

        <Divider />

        {/* Start Date Picker */}
        <View style={styles.section}>
          <ThemedText variant="small" color="primary" style={styles.sectionLabel}>
            STARTING DATE
          </ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dateRow}
          >
            {selectableDates.map((date) => {
              const selected = isSameDay(date, startDate);
              const dayName = date.toLocaleDateString('en-IN', { weekday: 'short' });
              const dayNum = date.getDate();
              const month = date.toLocaleDateString('en-IN', { month: 'short' });
              return (
                <TouchableOpacity
                  key={date.toISOString()}
                  style={[styles.datePill, selected && styles.datePillSelected]}
                  onPress={() => setStartDate(date)}
                  activeOpacity={0.7}
                >
                  <ThemedText
                    variant="micro"
                    color={selected ? 'mint' : 'muted'}
                    style={selected ? styles.datePillLabelActive : undefined}
                  >
                    {dayName}
                  </ThemedText>
                  <ThemedText
                    variant="body"
                    color={selected ? 'mint' : 'primary'}
                    style={selected ? styles.datePillNumActive : undefined}
                  >
                    {dayNum}
                  </ThemedText>
                  <ThemedText
                    variant="micro"
                    color={selected ? 'mint' : 'muted'}
                    style={selected ? styles.datePillLabelActive : undefined}
                  >
                    {month}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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
            style={[styles.payOpt, paymentMethod === 'razorpay' && styles.payOptSelected]}
            onPress={() => setPaymentMethod('razorpay')}
          >
            <ThemedText variant="body" color="primary">Pay Online (Razorpay)</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.payOpt, paymentMethod === 'wallet' && styles.payOptSelected]}
            onPress={() => setPaymentMethod('wallet')}
          >
            <ThemedText variant="body" color="primary">Wallet Balance</ThemedText>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Floating Subscribe button — mint outline style */}
      <TouchableOpacity
        style={[styles.subscribeBtn, { bottom: insets.bottom + 16 }]}
        activeOpacity={0.85}
        onPress={handleSubscribe}
        disabled={isSubscribing}
      >
        {isSubscribing ? (
          <ActivityIndicator color={Theme.colors.text.mint} />
        ) : (
          <>
            <Text style={styles.subscribeBtnText}>
              Subscribe · {formatPriceShort(plan.price)}
            </Text>
            <Text style={styles.subscribeBtnText}>›</Text>
          </>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: {},
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
  planDesc: {
    marginTop: 6,
    fontSize: Theme.typography.sizes.body + 2,
  },
  priceBlock: { marginTop: Theme.spacing.md },
  dateRow: {
    gap: 8,
    paddingVertical: Theme.spacing.xs,
  },
  datePill: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: 14,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
    backgroundColor: Theme.colors.background.secondary,
    minWidth: 52,
  },
  datePillSelected: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.background.secondary,
  },
  datePillLabelActive: { fontWeight: '600' },
  datePillNumActive: { fontWeight: '600' },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  payOpt: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  payOptSelected: { borderColor: Theme.colors.action.primary },
  subscribeBtn: {
    position: 'absolute',
    left: Theme.spacing.md,
    right: Theme.spacing.md,
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
  },
  subscribeBtnText: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.subtitle + 2,
    fontWeight: '400',
  },
});
