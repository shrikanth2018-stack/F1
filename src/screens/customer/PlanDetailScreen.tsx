/**
 * 1stOne F1 — Plan Detail Screen
 *
 * Redesigned header (Plan Name / Plan For / Duration / Daily Dispatch Time /
 * Total Cost), calendar (earliest selectable = today when within cutoff, else
 * tomorrow), Included Items labeled with the cycle name.
 *
 * CTA = BUY → atomically sets the single-plan cart slot and navigates to Cart
 * in subscription-only mode (no popup). Header is close-only (no back).
 *
 * Conflict rule: compares the plan's core items (item_ids) against the user's
 * active subscriptions of the same plan_type. On overlap, offers "Start After".
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  ScrollView,
  Alert,
  StyleSheet,
  TouchableOpacity,
  Text,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { useSubscriptionPlans, usePlanItems, useMySubscriptions } from '../../hooks/useSubscriptions';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useServerTime } from '../../hooks/useServerTime';
import { useCartStore } from '../../store/cartStore';
import { useEssentialsCartStore } from '../../store/essentialsCartStore';
import { formatPriceShort, formatDateShort } from '../../utils/formatters';
import { formatTime12h, getDispatchScenario } from '../../utils/timeEngine';
import { essentialsCycleLabel } from '../../utils/cycleLabels';
import { trackPlanViewed } from '../../utils/analytics';
import {
  findCoreItemConflict,
  planItemIds,
  startAfterDate,
  type ActiveSubForConflict,
} from '../../utils/subscriptionConflict';
import type { CartPlan } from '../../types';

/** Generate N calendar days starting from `offsetDays` from today. */
function getSelectableDates(count: number, offsetDays: number): Date[] {
  const dates: Date[] = [];
  for (let i = offsetDays; i < offsetDays + count; i++) {
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

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export function PlanDetailScreen({ route, navigation }: any) {
  const { planId } = route.params;
  const insets = useSafeAreaInsets();

  const { data: plans } = useSubscriptionPlans();
  const plan = plans?.find((p) => p.id === planId);
  const { data: planItems } = usePlanItems(planId);
  const { data: cycles } = useDeliveryCycles();
  const cycle = cycles?.find((c) => c.id === plan?.cycle_id);
  const { data: mySubs } = useMySubscriptions();
  const { data: serverTime } = useServerTime();

  const setFoodPlan = useCartStore((s) => s.setSinglePlan);
  const setEssPlan = useEssentialsCartStore((s) => s.setSinglePlan);

  React.useEffect(() => {
    if (plan) trackPlanViewed(plan.id, plan.plan_name, plan.price);
  }, [plan?.id]);

  // Earliest selectable start: today (A), tomorrow (B), or day-after-
  // tomorrow (C — cross-midnight cycle after its cutoff). Defaults to
  // tomorrow while cycle/serverTime are still loading.
  const earliestOffset = useMemo(() => {
    if (!cycle || !serverTime) return 1;
    const scenario = getDispatchScenario(cycle, serverTime);
    if (scenario === 'A') return 0;
    if (scenario === 'B') return 1;
    return 2; // 'C'
  }, [cycle, serverTime]);

  const selectableDates = useMemo(() => getSelectableDates(14, earliestOffset), [earliestOffset]);

  // Default pre-selection = the earliest valid date
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1); // provisional (tomorrow); effect below re-syncs once cycle loads
    return d;
  });

  // Keep the selection in sync once serverTime/cycle resolve
  React.useEffect(() => {
    const d = new Date();
    d.setDate(d.getDate() + earliestOffset);
    setStartDate(d);
  }, [earliestOffset]);

  const newItemIds = useMemo(() => planItemIds(planItems ?? []), [planItems]);
  const planType: 'food' | 'essentials' = plan?.plan_type ?? 'food';

  const pushToCart = useCallback((start: Date) => {
    if (!plan) return;
    const cartPlan: CartPlan = {
      plan_id: plan.id,
      plan_name: plan.plan_name,
      price: plan.price,
      duration_days: plan.duration_days,
      cycle_id: plan.cycle_id,
      plan_type: planType,
      start_date: toISODate(start),
      plan_item_ids: Array.from(newItemIds),
    };
    if (planType === 'food') setFoodPlan(cartPlan);
    else setEssPlan(cartPlan);
    // Subscription-only cart view — no popup
    navigation.navigate('Cart', { subscriptionPlanId: plan.id });
  }, [plan, planType, newItemIds, setFoodPlan, setEssPlan, navigation]);

  const activeSubs: ActiveSubForConflict[] = useMemo(() => {
    if (!mySubs) return [];
    return (mySubs as any[])
      .filter((s) => s.is_active)
      .map((s) => ({
        id: s.id,
        start_date: s.start_date,
        plan_id: s.plan_id,
        plan_items: (() => {
          const raw = s.subscription_plans?.plan_items;
          if (!raw) return [];
          if (Array.isArray(raw)) return raw;
          try { return JSON.parse(raw); } catch { return []; }
        })(),
        duration_days: s.subscription_plans?.duration_days ?? 0,
        plan_name: s.subscription_plans?.plan_name ?? 'existing plan',
        plan_type: s.subscription_plans?.plan_type ?? 'food',
        cycle_id: s.subscription_plans?.cycle_id ?? 0,
      }));
  }, [mySubs]);

  const handleBuy = useCallback(() => {
    if (!plan) return;
    const conflict = findCoreItemConflict(planType, newItemIds, activeSubs);
    if (conflict) {
      const afterStr = startAfterDate(conflict);
      const afterDate = new Date(afterStr);
      Alert.alert(
        'Subscription Conflict',
        `"${conflict.plan_name}" is already active and delivers the same item(s). You can queue this plan to start after it ends.`,
        [
          { text: `Start After (${formatDateShort(afterStr)})`, onPress: () => pushToCart(afterDate) },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }
    pushToCart(startDate);
  }, [plan, planType, newItemIds, activeSubs, startDate, pushToCart]);

  const goHome = () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] });

  if (!plan) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <ThemedText variant="header" color="primary" style={styles.headerTitle}>Plan Details</ThemedText>
          <TouchableOpacity onPress={goHome} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ThemedText variant="body" color="muted">Close</ThemedText>
          </TouchableOpacity>
        </View>
        <ThemedText variant="body" color="subtitle" style={styles.loading}>
          Loading...
        </ThemedText>
      </SafeAreaView>
    );
  }

  // Essentials plans show relabeled cycle (Morning/Noon/Evening); food plans show the real cycle_name.
  const planFor = cycle
    ? (planType === 'essentials' ? essentialsCycleLabel(cycle) : cycle.cycle_name)
    : '—';
  const dailyDispatch = formatTime12h(cycle?.delivery_start);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header — close-only */}
      <View style={styles.header}>
        <ThemedText variant="header" color="primary" style={styles.headerTitle}>Plan Details</ThemedText>
        <TouchableOpacity onPress={goHome} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="muted">Close</ThemedText>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}>
        {/* Structured plan info */}
        <View style={styles.section}>
          <InfoRow label="Plan Name" value={plan.plan_name} />
          <InfoRow label="Plan For" value={planFor} />
          <InfoRow label="Plan Duration" value={`${plan.duration_days} Days`} />
          <InfoRow label="Daily Dispatch Time" value={dailyDispatch} />
          <InfoRow label="Total Cost" value={formatPriceShort(plan.price)} highlight />
          {plan.savings_amount > 0 && (
            <InfoRow label="You Save" value={formatPriceShort(plan.savings_amount)} highlight large />
          )}
        </View>

        <Divider />

        {/* Included items — labeled with the cycle (Plan For) */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            {`INCLUDED IN ${planFor.toUpperCase()}`}
          </ThemedText>
          {(planItems ?? []).map((pi: any, idx: number) => (
            <View key={pi.item_id ?? idx} style={styles.itemRow}>
              <ThemedText variant="body" color="primary">
                {pi.item_name ?? `Item #${pi.item_id}`}
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

        {/* Start date calendar */}
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
                  <ThemedText variant="micro" color={selected ? 'mint' : 'muted'}>{dayName}</ThemedText>
                  <ThemedText
                    variant="body"
                    color={selected ? 'mint' : 'primary'}
                    style={selected ? styles.datePillNumActive : undefined}
                  >
                    {dayNum}
                  </ThemedText>
                  <ThemedText variant="micro" color={selected ? 'mint' : 'muted'}>{month}</ThemedText>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </ScrollView>

      {/* BUY — direct to Cart (sub-only mode) */}
      <TouchableOpacity
        style={[styles.subscribeBtn, { bottom: insets.bottom + 16 }]}
        activeOpacity={0.85}
        onPress={handleBuy}
      >
        <Text style={styles.subscribeBtnText}>
          {`BUY · ${formatPriceShort(plan.price)}`}
        </Text>
        <Text style={styles.subscribeBtnText}>›</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function InfoRow({ label, value, highlight, large }: { label: string; value: string; highlight?: boolean; large?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <ThemedText variant="small" color="muted">{label}</ThemedText>
      <ThemedText
        variant="body"
        color={highlight ? 'mint' : 'primary'}
        style={large ? { fontSize: Theme.typography.sizes.body + 2 } : undefined}
      >
        {value}
      </ThemedText>
    </View>
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
  headerTitle: { flex: 1, textAlign: 'left' },
  section: { padding: Theme.spacing.md },
  sectionLabel: { letterSpacing: 1, marginBottom: Theme.spacing.sm },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  dateRow: { paddingRight: Theme.spacing.md, gap: Theme.spacing.sm },
  datePill: {
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
    alignItems: 'center',
    minWidth: 60,
  },
  datePillSelected: { borderColor: Theme.colors.text.mint },
  datePillNumActive: { fontWeight: '600' },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.xs,
  },
  subscribeBtn: {
    position: 'absolute',
    left: Theme.spacing.md,
    right: Theme.spacing.md,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    shadowColor: Theme.colors.text.mint,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  subscribeBtnText: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    fontWeight: '600',
  },
});
