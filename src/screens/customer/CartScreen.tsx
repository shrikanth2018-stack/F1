/**
 * 1stOne F1 — Cart Screen
 *
 * Food and Essentials shown as separate sections.
 * Items grouped by dispatch scenario: Today (A) on top, Tomorrow (B) below.
 * Each checkout tap shows a confirmation with today/tomorrow counts.
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { useCartStore } from '../../store/cartStore';
import { useEssentialsCartStore } from '../../store/essentialsCartStore';
import { useSmartCart } from '../../hooks/useSmartCart';
import { useSmartEssentialsCart } from '../../hooks/useSmartEssentialsCart';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { formatPriceShort, formatDateShort } from '../../utils/formatters';
import { formatTime12h } from '../../utils/timeEngine';
import { confirmDialog } from '../../utils/confirmDialog';

export function CartScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const subscriptionPlanId: number | undefined = route?.params?.subscriptionPlanId;

  const foodItems = useCartStore((s) => s.items);
  const foodPlans = useCartStore((s) => s.plans);
  const updateFoodQty = useCartStore((s) => s.updateQuantity);
  const removeFoodItem = useCartStore((s) => s.removeItem);
  const removeFoodPlan = useCartStore((s) => s.removePlan);
  const clearFood = useCartStore((s) => s.clearCart);
  const foodTotal = useCartStore((s) => s.getDisplayTotal());

  const essItems = useEssentialsCartStore((s) => s.items);
  const essPlans = useEssentialsCartStore((s) => s.plans);
  const updateEssQty = useEssentialsCartStore((s) => s.updateQuantity);
  const removeEssItem = useEssentialsCartStore((s) => s.removeItem);
  const removeEssPlan = useEssentialsCartStore((s) => s.removePlan);
  const clearEss = useEssentialsCartStore((s) => s.clearCart);
  const essTotal = useEssentialsCartStore((s) => s.getDisplayTotal());

  const { evaluations } = useSmartCart();
  const { evaluations: essEvaluations } = useSmartEssentialsCart();
  const { data: cycles } = useDeliveryCycles();

  // Find delivery_start for a given cycle_id
  const getDeliveryTime = useCallback(
    (cycleId: number) => {
      const cycle = (cycles ?? []).find((c) => c.id === cycleId);
      return formatTime12h(cycle?.delivery_start);
    },
    [cycles]
  );

  // Group food items by scenario
  const todayFood = useMemo(
    () => foodItems.filter((i) => {
      const ev = evaluations.find((e) => e.menu_item_id === i.menu_item_id);
      return !ev || ev.scenario === 'A';
    }),
    [foodItems, evaluations]
  );
  const tomorrowFood = useMemo(
    () => foodItems.filter((i) => {
      const ev = evaluations.find((e) => e.menu_item_id === i.menu_item_id);
      return ev && ev.scenario === 'B';
    }),
    [foodItems, evaluations]
  );

  // Group essentials by scenario
  const todayEss = useMemo(
    () => essItems.filter((i) => {
      const ev = essEvaluations.find((e) => e.essential_item_id === i.essential_item_id);
      return !ev || ev.scenario === 'A';
    }),
    [essItems, essEvaluations]
  );
  const tomorrowEss = useMemo(
    () => essItems.filter((i) => {
      const ev = essEvaluations.find((e) => e.essential_item_id === i.essential_item_id);
      return ev && ev.scenario === 'B';
    }),
    [essItems, essEvaluations]
  );

  const confirmCheckout = useCallback(
    (cartType: 'food' | 'essentials') => {
      const todayCount = cartType === 'food' ? todayFood.length : todayEss.length;
      const tomorrowCount = cartType === 'food' ? tomorrowFood.length : tomorrowEss.length;

      const hasMixed = todayCount > 0 && tomorrowCount > 0;

      if (!hasMixed) {
        navigation.navigate('Checkout', { cartType });
        return;
      }

      const todayText = `${todayCount} item${todayCount !== 1 ? 's' : ''} dispatched today`;
      const tomorrowText = `${tomorrowCount} item${tomorrowCount !== 1 ? 's' : ''} dispatched tomorrow`;

      Alert.alert(
        'Mixed Dispatch',
        `${todayText}\n${tomorrowText}\n\nContinue to checkout?`,
        [
          { text: 'Alter Order', style: 'cancel' },
          { text: 'Yes, Continue', onPress: () => navigation.navigate('Checkout', { cartType }) },
        ]
      );
    },
    [todayFood, tomorrowFood, todayEss, tomorrowEss, navigation]
  );

  // ── Subscription-only mode ─────────────────────────────────
  // Entered via PlansScreen BUY (or PlanDetail BUY). Shows only the one plan,
  // no items, no other plans. One checkout button. Close → Home.
  const subPlan = subscriptionPlanId != null
    ? (foodPlans.find((p) => p.plan_id === subscriptionPlanId)
       ?? essPlans.find((p) => p.plan_id === subscriptionPlanId)
       ?? null)
    : null;

  // "Browse after clearing" — if we were in sub-mode but the plan has vanished
  // (checkout cleared the cart, or user removed it), bail to Home.
  React.useEffect(() => {
    if (subscriptionPlanId != null && !subPlan) {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    }
  }, [subscriptionPlanId, subPlan, navigation]);

  if (subscriptionPlanId != null) {
    if (!subPlan) return <SafeAreaView style={styles.container} />;

    const goHome = () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    const handleRemove = () => {
      if (subPlan.plan_type === 'food') removeFoodPlan(subPlan.plan_id);
      else removeEssPlan(subPlan.plan_id);
      goHome();
    };

    return (
      <SafeAreaView style={styles.container}>
        {/* Header — close-only (no back) */}
        <View style={styles.header}>
          <View style={{ width: 60 }} />
          <ThemedText variant="header" color="primary">Cart</ThemedText>
          <TouchableOpacity onPress={goHome} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ThemedText variant="body" color="muted">Close</ThemedText>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.cartSection}>
            <View style={styles.sectionHeader}>
              <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
                SUBSCRIPTION
              </ThemedText>
            </View>

            <View style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <ThemedText variant="body" color="primary">{subPlan.plan_name}</ThemedText>
                <ThemedText variant="small" color="muted">
                  Starts {formatDateShort(subPlan.start_date)} · {subPlan.duration_days} days
                </ThemedText>
              </View>
              <View style={styles.itemRight}>
                <TouchableOpacity onPress={handleRemove} style={styles.removeBtn}>
                  <ThemedText variant="micro" color="muted">Remove</ThemedText>
                </TouchableOpacity>
                <ThemedText variant="body" color="accent">
                  {formatPriceShort(subPlan.price)}
                </ThemedText>
              </View>
            </View>

            <View style={styles.sectionFooter}>
              <View style={styles.totalRow}>
                <ThemedText variant="small" color="subtitle">Subtotal</ThemedText>
                <ThemedText variant="small" color="primary">{formatPriceShort(subPlan.price)}</ThemedText>
              </View>
            </View>
          </View>
        </ScrollView>

        <TouchableOpacity
          style={[styles.floatBtn, { bottom: insets.bottom + 16 }]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Checkout', {
            cartType: subPlan.plan_type === 'essentials' ? 'essentials' : 'food',
            subscriptionPlanId: subPlan.plan_id,
          })}
          accessibilityRole="button"
          accessibilityLabel={`Pay ${formatPriceShort(subPlan.price)} for subscription`}
        >
          <ThemedText variant="body" style={styles.floatBtnText}>
            Pay {formatPriceShort(subPlan.price)} for Subscription
          </ThemedText>
          <ThemedText variant="body" style={styles.floatBtnText}>›</ThemedText>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (foodItems.length === 0 && essItems.length === 0 && foodPlans.length === 0 && essPlans.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          title="Cart is empty"
          subtitle="Add items from the menu"
          actionLabel="Browse Menu"
          onAction={() => navigation.goBack()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Cart</ThemedText>
        <TouchableOpacity
          onPress={async () => {
            const ok = await confirmDialog({
              title: 'Clear cart?',
              message: 'This will remove all items and any subscription plans from your cart.',
              confirmLabel: 'Clear All',
              destructive: true,
            });
            if (ok) { clearFood(); clearEss(); }
          }}
        >
          <ThemedText variant="small" color="muted">Clear All</ThemedText>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* ── FOOD CART ── */}
        {(foodItems.length > 0 || foodPlans.length > 0) && (
          <View style={styles.cartSection}>
            <View style={styles.sectionHeader}>
              <ThemedText variant="small" color="muted" style={styles.sectionLabel}>FOOD</ThemedText>
              <TouchableOpacity onPress={clearFood}>
                <ThemedText variant="micro" color="muted">Clear</ThemedText>
              </TouchableOpacity>
            </View>

            {/* Today group */}
            {todayFood.length > 0 && (
              <>
                {todayFood.map((item) => (
                  <View key={item.menu_item_id} style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <ThemedText variant="body" color="primary">{item.name}</ThemedText>
                      <ThemedText variant="small" color="muted">
                        Dispatch by {getDeliveryTime(item.cycle_id)}
                      </ThemedText>
                    </View>
                    <View style={styles.itemRight}>
                      <View style={styles.stepper}>
                        <TouchableOpacity
                          style={styles.stepBtn}
                          onPress={() =>
                            item.quantity <= 1
                              ? removeFoodItem(item.menu_item_id)
                              : updateFoodQty(item.menu_item_id, item.quantity - 1)
                          }
                        >
                          <ThemedText variant="body" color="primary">−</ThemedText>
                        </TouchableOpacity>
                        <ThemedText variant="body" color="primary" style={styles.qty}>
                          {item.quantity}
                        </ThemedText>
                        <TouchableOpacity
                          style={styles.stepBtn}
                          onPress={() => updateFoodQty(item.menu_item_id, item.quantity + 1)}
                        >
                          <ThemedText variant="body" color="primary">+</ThemedText>
                        </TouchableOpacity>
                      </View>
                      <ThemedText variant="body" color="accent">
                        {formatPriceShort(item.display_price * item.quantity)}
                      </ThemedText>
                    </View>
                  </View>
                ))}
                <View style={styles.groupFooter}>
                  <ThemedText variant="small" style={styles.todayLabel}>Dispatch Today</ThemedText>
                </View>
              </>
            )}

            {/* Separator between groups */}
            {todayFood.length > 0 && tomorrowFood.length > 0 && (
              <View style={styles.groupDivider} />
            )}

            {/* Tomorrow group */}
            {tomorrowFood.length > 0 && (
              <>
                {tomorrowFood.map((item) => (
                  <View key={item.menu_item_id} style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <ThemedText variant="body" color="primary">{item.name}</ThemedText>
                      <ThemedText variant="small" color="muted">
                        Dispatch by {getDeliveryTime(item.cycle_id)}
                      </ThemedText>
                    </View>
                    <View style={styles.itemRight}>
                      <View style={styles.stepper}>
                        <TouchableOpacity
                          style={styles.stepBtn}
                          onPress={() =>
                            item.quantity <= 1
                              ? removeFoodItem(item.menu_item_id)
                              : updateFoodQty(item.menu_item_id, item.quantity - 1)
                          }
                        >
                          <ThemedText variant="body" color="primary">−</ThemedText>
                        </TouchableOpacity>
                        <ThemedText variant="body" color="primary" style={styles.qty}>
                          {item.quantity}
                        </ThemedText>
                        <TouchableOpacity
                          style={styles.stepBtn}
                          onPress={() => updateFoodQty(item.menu_item_id, item.quantity + 1)}
                        >
                          <ThemedText variant="body" color="primary">+</ThemedText>
                        </TouchableOpacity>
                      </View>
                      <ThemedText variant="body" color="accent">
                        {formatPriceShort(item.display_price * item.quantity)}
                      </ThemedText>
                    </View>
                  </View>
                ))}
                <View style={styles.groupFooter}>
                  <ThemedText variant="small" style={styles.tomorrowLabel}>
                    Missed cutoff · Dispatched Tomorrow
                  </ThemedText>
                </View>
              </>
            )}

            {/* Food subscription plans */}
            {foodPlans.length > 0 && (
              <>
                {(foodItems.length > 0) && <View style={styles.groupDivider} />}
                <ThemedText variant="small" color="muted" style={styles.planSubLabel}>
                  SUBSCRIPTION PLANS
                </ThemedText>
                {foodPlans.map((p) => (
                  <View key={`food-plan-${p.plan_id}`} style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <ThemedText variant="body" color="primary">{p.plan_name}</ThemedText>
                      <ThemedText variant="small" color="muted">
                        Starts {formatDateShort(p.start_date)} · {p.duration_days} days
                      </ThemedText>
                    </View>
                    <View style={styles.itemRight}>
                      <TouchableOpacity onPress={() => removeFoodPlan(p.plan_id)} style={styles.removeBtn}>
                        <ThemedText variant="micro" color="muted">Remove</ThemedText>
                      </TouchableOpacity>
                      <ThemedText variant="body" color="accent">
                        {formatPriceShort(p.price)}
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </>
            )}

            <View style={styles.sectionFooter}>
              <View style={styles.totalRow}>
                <ThemedText variant="small" color="subtitle">Subtotal</ThemedText>
                <ThemedText variant="small" color="primary">{formatPriceShort(foodTotal)}</ThemedText>
              </View>
            </View>
          </View>
        )}

        {(foodItems.length > 0 || foodPlans.length > 0) &&
         (essItems.length > 0 || essPlans.length > 0) && <Divider />}

        {/* ── ESSENTIALS CART ── */}
        {(essItems.length > 0 || essPlans.length > 0) && (
          <View style={styles.cartSection}>
            <View style={styles.sectionHeader}>
              <ThemedText variant="small" color="muted" style={styles.sectionLabel}>ESSENTIALS</ThemedText>
              <TouchableOpacity onPress={clearEss}>
                <ThemedText variant="micro" color="muted">Clear</ThemedText>
              </TouchableOpacity>
            </View>

            {/* Today group */}
            {todayEss.length > 0 && (
              <>
                {todayEss.map((item) => (
                  <View key={item.essential_item_id} style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <ThemedText variant="body" color="primary">{item.name}</ThemedText>
                      <ThemedText variant="small" color="muted">
                        Dispatch by {getDeliveryTime(item.cycle_id)}
                      </ThemedText>
                    </View>
                    <View style={styles.itemRight}>
                      <View style={styles.stepper}>
                        <TouchableOpacity
                          style={styles.stepBtn}
                          onPress={() =>
                            item.quantity <= 1
                              ? removeEssItem(item.essential_item_id)
                              : updateEssQty(item.essential_item_id, item.quantity - 1)
                          }
                        >
                          <ThemedText variant="body" color="primary">−</ThemedText>
                        </TouchableOpacity>
                        <ThemedText variant="body" color="primary" style={styles.qty}>
                          {item.quantity}
                        </ThemedText>
                        <TouchableOpacity
                          style={styles.stepBtn}
                          onPress={() => updateEssQty(item.essential_item_id, item.quantity + 1)}
                        >
                          <ThemedText variant="body" color="primary">+</ThemedText>
                        </TouchableOpacity>
                      </View>
                      <ThemedText variant="body" color="accent">
                        {formatPriceShort(item.display_price * item.quantity)}
                      </ThemedText>
                    </View>
                  </View>
                ))}
                <View style={styles.groupFooter}>
                  <ThemedText variant="small" style={styles.todayLabel}>Dispatch Today</ThemedText>
                </View>
              </>
            )}

            {todayEss.length > 0 && tomorrowEss.length > 0 && (
              <View style={styles.groupDivider} />
            )}

            {/* Tomorrow group */}
            {/* ... */}
            {tomorrowEss.length > 0 && (
              <>
                {tomorrowEss.map((item) => (
                  <View key={item.essential_item_id} style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <ThemedText variant="body" color="primary">{item.name}</ThemedText>
                      <ThemedText variant="small" color="muted">
                        Dispatch by {getDeliveryTime(item.cycle_id)}
                      </ThemedText>
                    </View>
                    <View style={styles.itemRight}>
                      <View style={styles.stepper}>
                        <TouchableOpacity
                          style={styles.stepBtn}
                          onPress={() =>
                            item.quantity <= 1
                              ? removeEssItem(item.essential_item_id)
                              : updateEssQty(item.essential_item_id, item.quantity - 1)
                          }
                        >
                          <ThemedText variant="body" color="primary">−</ThemedText>
                        </TouchableOpacity>
                        <ThemedText variant="body" color="primary" style={styles.qty}>
                          {item.quantity}
                        </ThemedText>
                        <TouchableOpacity
                          style={styles.stepBtn}
                          onPress={() => updateEssQty(item.essential_item_id, item.quantity + 1)}
                        >
                          <ThemedText variant="body" color="primary">+</ThemedText>
                        </TouchableOpacity>
                      </View>
                      <ThemedText variant="body" color="accent">
                        {formatPriceShort(item.display_price * item.quantity)}
                      </ThemedText>
                    </View>
                  </View>
                ))}
                <View style={styles.groupFooter}>
                  <ThemedText variant="small" style={styles.tomorrowLabel}>
                    Missed cutoff · Dispatched Tomorrow
                  </ThemedText>
                </View>
              </>
            )}

            {/* Essentials subscription plans */}
            {essPlans.length > 0 && (
              <>
                {(essItems.length > 0) && <View style={styles.groupDivider} />}
                <ThemedText variant="small" color="muted" style={styles.planSubLabel}>
                  SUBSCRIPTION PLANS
                </ThemedText>
                {essPlans.map((p) => (
                  <View key={`ess-plan-${p.plan_id}`} style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <ThemedText variant="body" color="primary">{p.plan_name}</ThemedText>
                      <ThemedText variant="small" color="muted">
                        Starts {formatDateShort(p.start_date)} · {p.duration_days} days
                      </ThemedText>
                    </View>
                    <View style={styles.itemRight}>
                      <TouchableOpacity onPress={() => removeEssPlan(p.plan_id)} style={styles.removeBtn}>
                        <ThemedText variant="micro" color="muted">Remove</ThemedText>
                      </TouchableOpacity>
                      <ThemedText variant="body" color="accent">
                        {formatPriceShort(p.price)}
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </>
            )}

            <View style={styles.sectionFooter}>
              <View style={styles.totalRow}>
                <ThemedText variant="small" color="subtitle">Subtotal</ThemedText>
                <ThemedText variant="small" color="primary">{formatPriceShort(essTotal)}</ThemedText>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Floating checkout buttons */}
      {(foodItems.length > 0 || foodPlans.length > 0) && (
        <TouchableOpacity
          style={[styles.floatBtn, { bottom: insets.bottom + 16 }]}
          activeOpacity={0.85}
          onPress={() => confirmCheckout('food')}
        >
          <ThemedText variant="body" style={styles.floatBtnText}>
            Checkout Food · {formatPriceShort(foodTotal)}
          </ThemedText>
          <ThemedText variant="body" style={styles.floatBtnText}>›</ThemedText>
        </TouchableOpacity>
      )}
      {(essItems.length > 0 || essPlans.length > 0) && (
        <TouchableOpacity
          style={[
            styles.floatBtn,
            { bottom: (foodItems.length > 0 || foodPlans.length > 0) ? insets.bottom + 72 : insets.bottom + 16 },
          ]}
          activeOpacity={0.85}
          onPress={() => confirmCheckout('essentials')}
        >
          <ThemedText variant="body" style={styles.floatBtnText}>
            Checkout Essentials · {formatPriceShort(essTotal)}
          </ThemedText>
          <ThemedText variant="body" style={styles.floatBtnText}>›</ThemedText>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  content: { paddingBottom: Theme.spacing.xl },
  cartSection: { paddingHorizontal: Theme.spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
  },
  sectionLabel: { letterSpacing: 1 },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  itemInfo: { flex: 1, marginRight: Theme.spacing.sm },
  itemRight: { alignItems: 'flex-end' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 8,
    marginBottom: 4,
  },
  stepBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  qty: { minWidth: 24, textAlign: 'center' },
  groupFooter: {
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.xs,
  },
  todayLabel: {
    color: Theme.colors.status.success,
    fontFamily: Theme.typography.fontFamily,
  },
  tomorrowLabel: {
    color: Theme.colors.status.warning,
    fontFamily: Theme.typography.fontFamily,
  },
  groupDivider: {
    height: 1,
    backgroundColor: Theme.colors.layout.divider,
    marginVertical: Theme.spacing.sm,
  },
  planSubLabel: {
    letterSpacing: 1,
    marginTop: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
  },
  removeBtn: { paddingHorizontal: 4, paddingVertical: 2, marginBottom: 2 },
  sectionFooter: { paddingVertical: Theme.spacing.sm },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  floatBtn: {
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
  floatBtnText: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.subtitle + 2,
    fontWeight: '400',
  },
});
