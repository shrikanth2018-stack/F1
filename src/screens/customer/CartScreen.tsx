/**
 * 1stOne F1 — Cart Screen
 *
 * Food and Essentials shown as separate sections. Within each, items are
 * grouped BY DELIVERY CYCLE — one block per cycle, headed with the cycle name
 * and its dispatch day. This mirrors HomeScreen (cycle-grouped menu) and the
 * order itself (one row per cycle), so the whole flow reads consistently.
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
import { useOrderQuote } from '../../hooks/useOrderQuote';
import { useAddresses } from '../../hooks/useAddresses';

type Scenario = 'A' | 'B' | 'C';

interface CycleGroup<T> {
  cycleId: number;
  cycleName: string;
  scenario: Scenario;
  items: T[];
}

/** Group cart items by delivery cycle, ordered earliest dispatch day first. */
function groupByCycle<T extends { cycle_id: number }>(
  items: T[],
  scenarioOf: (item: T) => Scenario,
  cycles: { id: number; cycle_name: string }[],
): CycleGroup<T>[] {
  const byCycle = new Map<number, T[]>();
  for (const it of items) {
    const list = byCycle.get(it.cycle_id) ?? [];
    list.push(it);
    byCycle.set(it.cycle_id, list);
  }
  const rank: Record<Scenario, number> = { A: 0, B: 1, C: 2 };
  const groups: CycleGroup<T>[] = [...byCycle.entries()].map(([cycleId, list]) => ({
    cycleId,
    cycleName: cycles.find((c) => c.id === cycleId)?.cycle_name ?? 'Items',
    scenario: scenarioOf(list[0]),
    items: list,
  }));
  groups.sort((a, b) => rank[a.scenario] - rank[b.scenario] || a.cycleName.localeCompare(b.cycleName));
  return groups;
}

const dayLabel = (s: Scenario): string =>
  s === 'A' ? 'Today' : s === 'B' ? 'Tomorrow' : 'Day after tomorrow';

const itemsToday = (groups: CycleGroup<any>[]): number =>
  groups.filter((g) => g.scenario === 'A').reduce((s, g) => s + g.items.length, 0);
const itemsLater = (groups: CycleGroup<any>[]): number =>
  groups.filter((g) => g.scenario !== 'A').reduce((s, g) => s + g.items.length, 0);

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

  // Server-authoritative cart preview. Pre-pass uses the default serviceable
  // address so the cart shows the full total incl. delivery fee; with no
  // usable default it quotes address-less (fee shown at checkout).
  const { data: addresses } = useAddresses();
  const defaultAddressId = useMemo(
    () =>
      addresses?.find((a) => a.is_default && a.is_serviceable !== false)?.id ??
      addresses?.find((a) => a.is_serviceable !== false)?.id ??
      null,
    [addresses],
  );
  const { data: foodQuote } = useOrderQuote({
    items: foodItems.map((i) => ({ item_id: i.menu_item_id, item_type: 'food' as const, quantity: i.quantity })),
    subscriptionPlans: foodPlans.map((p) => ({ plan_id: p.plan_id, start_date: p.start_date })),
    deliveryAddressId: defaultAddressId,
    enabled: subscriptionPlanId == null && (foodItems.length > 0 || foodPlans.length > 0),
  });
  const { data: essQuote } = useOrderQuote({
    items: essItems.map((i) => ({ item_id: i.essential_item_id, item_type: 'essential' as const, quantity: i.quantity })),
    subscriptionPlans: essPlans.map((p) => ({ plan_id: p.plan_id, start_date: p.start_date })),
    deliveryAddressId: defaultAddressId,
    enabled: subscriptionPlanId == null && (essItems.length > 0 || essPlans.length > 0),
  });

  const getDeliveryTime = useCallback(
    (cycleId: number) => formatTime12h((cycles ?? []).find((c) => c.id === cycleId)?.delivery_start),
    [cycles],
  );

  // ── Cycle grouping ──────────────────────────────────────────
  const foodGroups = useMemo(
    () => groupByCycle(
      foodItems,
      (it) => evaluations.find((e) => e.menu_item_id === it.menu_item_id)?.scenario ?? 'A',
      cycles ?? [],
    ),
    [foodItems, evaluations, cycles],
  );
  const essGroups = useMemo(
    () => groupByCycle(
      essItems,
      (it) => essEvaluations.find((e) => e.essential_item_id === it.essential_item_id)?.scenario ?? 'A',
      cycles ?? [],
    ),
    [essItems, essEvaluations, cycles],
  );

  // Any cycle with a missed cutoff → one-line banner.
  const anyMissedCutoff =
    foodGroups.some((g) => g.scenario !== 'A') || essGroups.some((g) => g.scenario !== 'A');

  const confirmCheckout = useCallback(
    (cartType: 'food' | 'essentials') => {
      const groups = cartType === 'food' ? foodGroups : essGroups;
      const today = itemsToday(groups);
      const later = itemsLater(groups);

      if (!(today > 0 && later > 0)) {
        navigation.navigate('Checkout', { cartType });
        return;
      }
      Alert.alert(
        'Mixed Dispatch',
        `${today} item${today !== 1 ? 's' : ''} dispatched today\n` +
        `${later} item${later !== 1 ? 's' : ''} dispatched later\n\nContinue to checkout?`,
        [
          { text: 'Alter Order', style: 'cancel' },
          { text: 'Yes, Continue', onPress: () => navigation.navigate('Checkout', { cartType }) },
        ],
      );
    },
    [foodGroups, essGroups, navigation],
  );

  // ── Shared item-row renderer (DRY — used by food + essentials) ──
  const renderRow = (
    key: string,
    name: string,
    qty: number,
    lineTotal: number,
    onDecrement: () => void,
    onIncrement: () => void,
  ) => (
    <View key={key} style={styles.itemRow}>
      <View style={styles.itemInfo}>
        <ThemedText variant="body" color="primary">{name}</ThemedText>
      </View>
      <View style={styles.itemRight}>
        <View style={styles.stepper}>
          <TouchableOpacity style={styles.stepBtn} onPress={onDecrement}>
            <ThemedText variant="body" color="primary">−</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="body" color="primary" style={styles.qty}>{qty}</ThemedText>
          <TouchableOpacity style={styles.stepBtn} onPress={onIncrement}>
            <ThemedText variant="body" color="primary">+</ThemedText>
          </TouchableOpacity>
        </View>
        <ThemedText variant="body" color="accent">{formatPriceShort(lineTotal)}</ThemedText>
      </View>
    </View>
  );

  /** One cycle block — header (name + dispatch day) then its item rows. */
  const renderCycleGroup = (g: CycleGroup<any>, rows: React.ReactNode) => (
    <View key={`cyc-${g.cycleId}`} style={styles.cycleGroup}>
      <ThemedText variant="small" color="mint" style={styles.cycleName}>{g.cycleName}</ThemedText>
      <ThemedText
        variant="micro"
        style={[styles.cycleDay, g.scenario !== 'A' && styles.cycleDayMissed]}
      >
        {dayLabel(g.scenario)} · dispatch by {getDeliveryTime(g.cycleId)}
      </ThemedText>
      {rows}
    </View>
  );

  // ── Subscription-only mode ─────────────────────────────────
  const subPlan = subscriptionPlanId != null
    ? (foodPlans.find((p) => p.plan_id === subscriptionPlanId)
       ?? essPlans.find((p) => p.plan_id === subscriptionPlanId)
       ?? null)
    : null;

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

  const foodHasContent = foodItems.length > 0 || foodPlans.length > 0;
  const essHasContent = essItems.length > 0 || essPlans.length > 0;

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

      {/* Missed-cutoff banner — one line, persistent while any cycle is late */}
      {anyMissedCutoff && (
        <View style={styles.cutoffBanner}>
          <ThemedText variant="small" style={styles.cutoffBannerText}>
            Some items missed today's cutoff — check each cycle's delivery day below.
          </ThemedText>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content}>

        {/* ── FOOD CART ── */}
        {foodHasContent && (
          <View style={styles.cartSection}>
            <View style={styles.sectionHeader}>
              <ThemedText variant="small" color="muted" style={styles.sectionLabel}>FOOD</ThemedText>
              <TouchableOpacity onPress={clearFood}>
                <ThemedText variant="micro" color="muted">Clear</ThemedText>
              </TouchableOpacity>
            </View>

            {/* One block per delivery cycle */}
            {foodGroups.map((g) =>
              renderCycleGroup(
                g,
                g.items.map((item) => renderRow(
                  `f-${item.menu_item_id}`,
                  item.name,
                  item.quantity,
                  item.display_price * item.quantity,
                  () => (item.quantity <= 1
                    ? removeFoodItem(item.menu_item_id)
                    : updateFoodQty(item.menu_item_id, item.quantity - 1)),
                  () => updateFoodQty(item.menu_item_id, item.quantity + 1),
                )),
              ),
            )}

            {/* Food subscription plans */}
            {foodPlans.length > 0 && (
              <>
                {foodItems.length > 0 && <View style={styles.groupDivider} />}
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
              <View style={styles.totalRow}>
                <ThemedText variant="small" color="subtitle">Tax</ThemedText>
                <ThemedText variant="small" color="primary">
                  {foodQuote ? formatPriceShort(foodQuote.tax_total) : '—'}
                </ThemedText>
              </View>
              <View style={styles.totalRow}>
                <ThemedText variant="small" color="subtitle">Total</ThemedText>
                <ThemedText variant="small" color="accent">
                  {foodQuote ? formatPriceShort(foodQuote.grand_total) : '—'}
                </ThemedText>
              </View>
              {foodQuote?.fee_pending && (
                <ThemedText variant="micro" color="muted">+ delivery fee added at checkout</ThemedText>
              )}
            </View>
          </View>
        )}

        {foodHasContent && essHasContent && <Divider />}

        {/* ── ESSENTIALS CART ── */}
        {essHasContent && (
          <View style={styles.cartSection}>
            <View style={styles.sectionHeader}>
              <ThemedText variant="small" color="muted" style={styles.sectionLabel}>ESSENTIALS</ThemedText>
              <TouchableOpacity onPress={clearEss}>
                <ThemedText variant="micro" color="muted">Clear</ThemedText>
              </TouchableOpacity>
            </View>

            {essGroups.map((g) =>
              renderCycleGroup(
                g,
                g.items.map((item) => renderRow(
                  `e-${item.essential_item_id}`,
                  item.name,
                  item.quantity,
                  item.display_price * item.quantity,
                  () => (item.quantity <= 1
                    ? removeEssItem(item.essential_item_id)
                    : updateEssQty(item.essential_item_id, item.quantity - 1)),
                  () => updateEssQty(item.essential_item_id, item.quantity + 1),
                )),
              ),
            )}

            {/* Essentials subscription plans */}
            {essPlans.length > 0 && (
              <>
                {essItems.length > 0 && <View style={styles.groupDivider} />}
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
              <View style={styles.totalRow}>
                <ThemedText variant="small" color="subtitle">Tax</ThemedText>
                <ThemedText variant="small" color="primary">
                  {essQuote ? formatPriceShort(essQuote.tax_total) : '—'}
                </ThemedText>
              </View>
              <View style={styles.totalRow}>
                <ThemedText variant="small" color="subtitle">Total</ThemedText>
                <ThemedText variant="small" color="accent">
                  {essQuote ? formatPriceShort(essQuote.grand_total) : '—'}
                </ThemedText>
              </View>
              {essQuote?.fee_pending && (
                <ThemedText variant="micro" color="muted">+ delivery fee added at checkout</ThemedText>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Floating checkout buttons */}
      {foodHasContent && (
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
      {essHasContent && (
        <TouchableOpacity
          style={[styles.floatBtn, { bottom: foodHasContent ? insets.bottom + 72 : insets.bottom + 16 }]}
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
  cutoffBanner: {
    backgroundColor: Theme.colors.status.warning + '22',
    borderLeftWidth: 3,
    borderLeftColor: Theme.colors.status.warning,
    marginHorizontal: Theme.spacing.md,
    marginTop: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderRadius: 6,
  },
  cutoffBannerText: { color: Theme.colors.status.warning },
  cartSection: { paddingHorizontal: Theme.spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
  },
  sectionLabel: { letterSpacing: 1 },

  // Per-cycle block
  cycleGroup: { marginBottom: Theme.spacing.sm },
  cycleName: { letterSpacing: 0.5, marginTop: Theme.spacing.xs },
  cycleDay: {
    color: Theme.colors.text.muted,
    marginBottom: Theme.spacing.xs,
  },
  cycleDayMissed: { color: Theme.colors.status.warning },

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
  },
});
