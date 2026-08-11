/**
 * 1stOne F1 — Cart Screen
 *
 * ONE BLOCK PER DELIVERY — the bag that actually turns up, headed with its
 * cycle and dispatch day, in the order the bags go out.
 *
 * It used to split FOOD from ESSENTIALS at the top level and group by cycle
 * inside each. That put "Lunch" on the screen twice and separated the fried
 * rice from the curd travelling in the same bag — the same thing the rail, My
 * Orders and the order detail page all now show together. It also sorted
 * cycles by NAME, so Dinner (7:30 PM) sat above Lunch (12:30 PM).
 *
 * Each block carries two things beyond its items: a photo picker to add
 * something else to that same bag, and — where a plan already delivers what
 * you are buying — what it would cost on subscription instead.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import { useCartStore } from '../../store/cartStore';
import type { CartItem } from '../../types';
import { useSmartCart } from '../../hooks/useSmartCart';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { formatPriceShort, formatDateShort, plural } from '../../utils/formatters';
import { formatTime12h } from '../../utils/timeEngine';
import { confirmDialog } from '../../utils/confirmDialog';
import { useOrderQuote } from '../../hooks/useOrderQuote';
import { useAddresses } from '../../hooks/useAddresses';
import { useEssentialsEnabled } from '../../hooks/useEssentialsEnabled';
import { useMenuItems } from '../../hooks/useMenuItems';
import { useEssentialsCatalog } from '../../hooks/useEssentials';
import { useSubscriptionPlans } from '../../hooks/useSubscriptions';
import { bestCartSaving, humaniseDuration } from '../../utils/subscriptionSavings';
import { AddExtraStrip } from './components/AddExtraStrip';
import {
  groupIntoBlocks,
  extrasByCycle as buildExtrasByCycle,
  itemsToday,
  itemsLater,
  type DeliveryBlock,
  type ExtraCandidate,
} from '../../utils/cartBlocks';

type Scenario = 'A' | 'B' | 'C';

/** See the note where this is used — three named states, not two falsy ones. */
type ExtrasOpen =
  | { kind: 'untouched' }
  | { kind: 'closed' }
  | { kind: 'open'; cycleId: number };

/**
 * Left to right, horizontally. Declared once as constants because a fresh
 * object literal per render makes LinearGradient re-evaluate its shader on
 * every pass.
 */
const FADE_START = { x: 0, y: 0 };
const FADE_END = { x: 1, y: 0 };

const dayLabel = (s: Scenario): string =>
  s === 'A' ? 'Today' : s === 'B' ? 'Tomorrow' : 'Day after tomorrow';


export function CartScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const subscriptionPlanId: number | undefined = route?.params?.subscriptionPlanId;

  const allItems = useCartStore((s) => s.items);
  const cartPlans = useCartStore((s) => s.plans);
  const addItem = useCartStore((s) => s.addItem);
  const updateQty = useCartStore((s) => s.updateQuantity);
  const removeCartItem = useCartStore((s) => s.removeItem);
  const removeCartPlan = useCartStore((s) => s.removePlan);
  const clearCart = useCartStore((s) => s.clearCart);
  const cartTotal = useCartStore((s) => s.getDisplayTotal());

  const { evaluations } = useSmartCart();
  const { data: cycles } = useDeliveryCycles();
  // Essentials module gate. When the admin turns essentials_module_active
  // off, the cart hides every essentials surface — list + checkout button.
  // Items already in the local essentials cart stay in storage (we don't
  // clear them) so flipping the flag back on restores the cart as it was.
  // NOTE: must be called here with the other hooks — it previously sat
  // below the early returns, which changes the hook count between renders
  // (React "rendered fewer hooks" crash) when the cart empties/fills.
  const essentialsEnabled = useEssentialsEnabled();

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
  // ONE quote for the whole cart — one delivery fee, one GST figure, one
  // total. This is the number the customer pays.
  const { data: cartQuote } = useOrderQuote({
    items: allItems.map((i) => ({ item_id: i.item_id, item_type: i.item_type, quantity: i.quantity })),
    subscriptionPlans: cartPlans.map((p) => ({ plan_id: p.plan_id, start_date: p.start_date })),
    deliveryAddressId: defaultAddressId,
    enabled: subscriptionPlanId == null && (allItems.length > 0 || cartPlans.length > 0),
  });

  // Float-button amount = the server-quoted grand total (items + delivery;
  // GST is already inside the item prices), falling back to the display
  // subtotal only while the quote is in flight.
  const grandTotal = cartQuote?.grand_total ?? cartTotal;

  const getDeliveryTime = useCallback(
    (cycleId: number) => formatTime12h((cycles ?? []).find((c) => c.id === cycleId)?.delivery_start),
    [cycles],
  );

  // ── Cycle grouping ──────────────────────────────────────────
  // Lookup takes BOTH id and type: the two catalogues have independent id
  // sequences, so menu item 31 and essential 31 are different products.
  const scenarioOf = useCallback(
    (it: { item_id: number; item_type: 'food' | 'essential' }) =>
      evaluations.find((e) => e.item_id === it.item_id && e.item_type === it.item_type)
        ?.scenario ?? 'A',
    [evaluations],
  );
  // ONE list of bags, food and essentials together. `essentialsEnabled`
  // still excludes essentials from the view when the module is off, exactly
  // as the separate ESSENTIALS section used to.
  const visibleItems = useMemo(
    () => (essentialsEnabled ? allItems : allItems.filter((i) => i.item_type === 'food')),
    [allItems, essentialsEnabled],
  );
  const blocks = useMemo(
    () => groupIntoBlocks(visibleItems, scenarioOf, cycles ?? []),
    [visibleItems, scenarioOf, cycles],
  );

  // Any cycle with a missed cutoff → one-line banner.
  const anyMissedCutoff = blocks.some((b) => b.scenario !== 'A');

  // ── Catalogue, for the add-extra picker and the savings maths ──
  const cycleIds = useMemo(() => (cycles ?? []).map((c) => c.id), [cycles]);
  const { data: menuItems } = useMenuItems(cycleIds.length > 0 ? cycleIds : undefined);
  const { data: essentialsCatalog } = useEssentialsCatalog();
  const { data: plans } = useSubscriptionPlans();

  /** Today's price for any catalogue item, either side. Null when unknown. */
  const priceOf = useCallback(
    (itemId: number): number | null => {
      const m = (menuItems ?? []).find((x) => x.id === itemId);
      if (m) return Number(m.price);
      const e = (essentialsCatalog ?? []).find((x) => x.id === itemId);
      if (e) return Number(e.price);
      return null;
    },
    [menuItems, essentialsCatalog],
  );

  /**
   * Which delivery's picker is open. ONE at a time, cart-wide: three open
   * pickers is three unresolved decisions on screen, which is what made a
   * multi-cycle cart unreadable.
   *
   * THREE STATES, and the third is the point:
   *
   *   untouched — the customer has not decided, so the SOONEST delivery is
   *               open. That single rule gives both behaviours: a one-cycle
   *               cart simply has its picker open, and a busy one opens the
   *               bag going out first, which is the last one still worth
   *               adding to.
   *   closed    — they closed it. It must STAY closed; springing open again
   *               on the next render (an item added, a quantity nudged)
   *               reads as the screen fighting them.
   *   open      — the one they picked.
   *
   * A union rather than `number | null | undefined`, deliberately. Those two
   * empty values are both falsy and both look like "nothing", so the next
   * person to tidy this writes `useState<number | null>(null)`, it compiles,
   * and the default-open quietly dies — a change no test would catch, since
   * a default is not a behaviour anything asserts. Named states cannot be
   * conflated by accident. Same shape as BuildResult in orderBuild.ts.
   */
  const [extrasOpen, setExtrasOpen] = useState<ExtrasOpen>({ kind: 'untouched' });

  const openCycleId: number | null =
    extrasOpen.kind === 'open' ? extrasOpen.cycleId
      : extrasOpen.kind === 'closed' ? null
        : blocks[0]?.cycleId ?? null;

  /**
   * ONE subscription offer for the cart, shown below the total.
   *
   * It used to sit under each matching item, where it wrapped to two lines,
   * pushed the item away from its own "Add something else?", and repeated the
   * same argument down the page. Below the total it is read once, at the
   * moment the customer is deciding what to pay — and only the biggest saving
   * appears, because three competing offers make each of them smaller.
   */
  const cartSaving = useMemo(
    () => bestCartSaving(visibleItems, plans ?? [], priceOf),
    [visibleItems, plans, priceOf],
  );

  /** See extrasByCycle — the filtering and ordering live in cartBlocks.ts. */
  const extrasByCycle = useMemo(
    () => buildExtrasByCycle(menuItems ?? [], essentialsCatalog ?? [], allItems, essentialsEnabled),
    [menuItems, essentialsCatalog, allItems, essentialsEnabled],
  );

  const addExtra = useCallback((c: ExtraCandidate) => {
    addItem({
      item_id: c.item_id, item_type: c.item_type, cycle_id: c.cycle_id,
      name: c.name, display_price: c.price, unit: c.unit ?? undefined,
    });
  }, [addItem]);

  // ONE checkout for the whole cart. There used to be two buttons —
  // "Checkout Food · ₹50" and "Checkout Essentials · ₹35" — so ₹85 of
  // shopping sitting in one place had to be paid for twice. The server has
  // always accepted a mixed cart; only this screen did not.
  const confirmCheckout = useCallback(
    () => {
      const today = itemsToday(blocks);
      const later = itemsLater(blocks);

      if (!(today > 0 && later > 0)) {
        navigation.navigate('Checkout', {});
        return;
      }
      Alert.alert(
        'Mixed Dispatch',
        `${plural(today, 'item')} dispatched today\n` +
        `${plural(later, 'item')} dispatched later\n\nContinue to checkout?`,
        [
          { text: 'Alter Order', style: 'cancel' },
          { text: 'Yes, Continue', onPress: () => navigation.navigate('Checkout', {}) },
        ],
      );
    },
    [blocks, navigation],
  );

  /**
   * ONE LINE PER ITEM: name, stepper, price.
   *
   * The name used to sit on its own row with the stepper and the price
   * stacked beneath it on the right — three lines and ~200pt for a single
   * dish, so a four-item cart did not fit on a screen. Nothing was gained by
   * the height; the same three facts fit across one row.
   */
  const renderRow = (item: CartItem) => {
    const lineTotal = item.display_price * item.quantity;
    return (
      <View key={`${item.item_type}-${item.item_id}`}>
        <View style={styles.itemRow}>
          <ThemedText variant="body" color="primary" style={styles.itemName} numberOfLines={1}>
            {item.name}
          </ThemedText>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => (item.quantity <= 1
                ? removeCartItem(item.item_id, item.item_type)
                : updateQty(item.item_id, item.item_type, item.quantity - 1))}
            >
              <ThemedText variant="body" color="primary">−</ThemedText>
            </TouchableOpacity>
            <ThemedText variant="body" color="primary" style={styles.qty}>{item.quantity}</ThemedText>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => updateQty(item.item_id, item.item_type, item.quantity + 1)}
            >
              <ThemedText variant="body" color="primary">+</ThemedText>
            </TouchableOpacity>
          </View>
          <ThemedText variant="body" color="accent" style={styles.itemPrice}>
            {formatPriceShort(lineTotal)}
          </ThemedText>
        </View>

      </View>
    );
  };

  /** One delivery: header, its items, and what else could ride along. */
  const renderBlock = (b: DeliveryBlock) => (
    <View key={`cyc-${b.cycleId}`} style={styles.cycleGroup}>
      <ThemedText variant="small" color="mint" style={styles.cycleName}>{b.cycleName}</ThemedText>
      <ThemedText
        variant="micro"
        style={[styles.cycleDay, b.scenario !== 'A' && styles.cycleDayMissed]}
      >
        {dayLabel(b.scenario)} · dispatch by {getDeliveryTime(b.cycleId)}
      </ThemedText>
      {b.items.map(renderRow)}
      <AddExtraStrip
        candidates={extrasByCycle.get(b.cycleId) ?? []}
        expanded={openCycleId === b.cycleId}
        onToggle={() => setExtrasOpen(
          openCycleId === b.cycleId ? { kind: 'closed' } : { kind: 'open', cycleId: b.cycleId },
        )}
        onAdd={addExtra}
      />
    </View>
  );

  // ── Subscription-only mode ─────────────────────────────────
  const subPlan = subscriptionPlanId != null
    ? (cartPlans.find((p) => p.plan_id === subscriptionPlanId) ?? null)
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
      removeCartPlan(subPlan.plan_id);
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
              <TouchableOpacity onPress={handleRemove} style={styles.removeBtn}>
                <ThemedText variant="micro" color="muted">Remove</ThemedText>
              </TouchableOpacity>
              <ThemedText variant="body" color="accent" style={styles.itemPrice}>
                {formatPriceShort(subPlan.price)}
              </ThemedText>
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

  if (allItems.length === 0 && cartPlans.length === 0) {
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
            if (ok) clearCart();
          }}
        >
          <ThemedText variant="small" color="muted">Clear All</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Missed-cutoff banner — one line, persistent while any cycle is late */}
      {anyMissedCutoff && (
        <LinearGradient
          colors={[
            `${Theme.colors.status.warning}26`,
            `${Theme.colors.status.warning}12`,
            `${Theme.colors.status.warning}00`,
          ]}
          locations={[0, 0.55, 1]}
          start={FADE_START}
          end={FADE_END}
          style={styles.cutoffBanner}
        >
          <ThemedText variant="small" style={styles.cutoffBannerText}>
            Some items missed today's cutoff — check each cycle's delivery day below.
          </ThemedText>
        </LinearGradient>
      )}

      <ScrollView contentContainerStyle={styles.content}>

        {/* ── One block per delivery, soonest first ── */}
        <View style={styles.cartSection}>
          {blocks.map(renderBlock)}

          {/* Plans belong to the cart, not to any one delivery — a plan is
              bought once and runs; it is not in a bag going out tonight. */}
          {cartPlans.length > 0 && (
            <>
              {blocks.length > 0 && <View style={styles.groupDivider} />}
              <ThemedText variant="small" color="muted" style={styles.planSubLabel}>
                SUBSCRIPTION PLANS
              </ThemedText>
              {cartPlans.map((p) => (
                <View key={`plan-${p.plan_id}`} style={styles.itemRow}>
                  <View style={styles.itemInfo}>
                    <ThemedText variant="body" color="primary">{p.plan_name}</ThemedText>
                    <ThemedText variant="micro" color="muted">
                      Starts {formatDateShort(p.start_date)} · {p.duration_days} days
                    </ThemedText>
                  </View>
                  <TouchableOpacity onPress={() => removeCartPlan(p.plan_id)} style={styles.removeBtn}>
                    <ThemedText variant="micro" color="muted">Remove</ThemedText>
                  </TouchableOpacity>
                  <ThemedText variant="body" color="accent" style={styles.itemPrice}>
                    {formatPriceShort(p.price)}
                  </ThemedText>
                </View>
              ))}
            </>
          )}
        </View>

        {/* ── ONE total for the whole cart ── */}
        <View style={styles.cartSection}>
          <View style={styles.sectionFooter}>
            <View style={styles.totalRow}>
              <ThemedText variant="small" color="subtitle">Subtotal</ThemedText>
              <ThemedText variant="small" color="primary">{formatPriceShort(cartTotal)}</ThemedText>
            </View>
            <View style={styles.totalRow}>
              <ThemedText variant="small" color="subtitle">Delivery</ThemedText>
              <ThemedText variant="small" color="primary">
                {!cartQuote
                  ? '—'
                  : cartQuote.fee_pending
                    ? 'At checkout'
                    : cartQuote.delivery_fee === 0
                      ? 'Free'
                      : formatPriceShort(cartQuote.delivery_fee)}
              </ThemedText>
            </View>
            <View style={styles.totalRow}>
              <ThemedText variant="small" color="subtitle">Total</ThemedText>
              <ThemedText variant="small" color="accent">{formatPriceShort(grandTotal)}</ThemedText>
            </View>
            {!!cartQuote && cartQuote.tax_total > 0 && (
              <ThemedText variant="micro" color="muted">
                Incl. GST {formatPriceShort(cartQuote.tax_total)}
              </ThemedText>
            )}
          </View>

          {cartSaving && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => navigation.navigate('PlanDetail', { planId: cartSaving.planId })}
              accessibilityRole="button"
              accessibilityLabel={`Subscribe and save ${formatPriceShort(cartSaving.totalSaving)} on ${cartSaving.itemName}`}
            >
              <LinearGradient
                colors={[
                  `${Theme.colors.text.mint}1F`,
                  `${Theme.colors.text.mint}0F`,
                  `${Theme.colors.text.mint}00`,
                ]}
                locations={[0, 0.55, 1]}
                start={FADE_START}
                end={FADE_END}
                style={styles.saveBanner}
              >
                <ThemedText variant="small" color="mint">
                  Save {formatPriceShort(cartSaving.totalSaving)} over{' '}
                  {humaniseDuration(cartSaving.durationDays)} on {cartSaving.itemName} with a
                  subscription!
                </ThemedText>
                <ThemedText variant="small" color="mint" style={styles.saveBannerCta}>
                  Subscribe ›
                </ThemedText>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* ONE checkout button. Two of these — "Checkout Food" stacked above
          "Checkout Essentials" — were the clearest symptom of the split
          cart: the customer could see their whole basket and still had to
          pay for it twice. */}
      <TouchableOpacity
        style={[styles.floatBtn, { bottom: insets.bottom + 16 }]}
        activeOpacity={0.85}
        onPress={confirmCheckout}
      >
        <ThemedText variant="body" style={styles.floatBtnText}>
          Checkout · {formatPriceShort(grandTotal)}
        </ThemedText>
        <ThemedText variant="body" style={styles.floatBtnText}>›</ThemedText>
      </TouchableOpacity>
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
  /**
   * Fades out to the right so it reads as a marked passage of the page rather
   * than a card sitting on it. The solid left edge is what still makes it a
   * marker; the fill just stops mattering before it reaches the other side.
   *
   * Rounded on the LEFT only. A right-hand corner radius describes an edge,
   * and there is no edge there any more — the whole point is that the reader
   * cannot say where it ends.
   */
  cutoffBanner: {
    borderLeftWidth: 3,
    borderLeftColor: Theme.colors.status.warning,
    marginHorizontal: Theme.spacing.md,
    marginTop: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
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
    alignItems: 'center',
    // xs, not sm: the row is one line now, so the old padding left it
    // floating in its own paragraph.
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  itemInfo: { flex: 1, marginRight: Theme.spacing.sm },
  /** Takes the slack, so the stepper and price hold the same column down the
   *  list however long a dish is called. */
  itemName: { flex: 1, marginRight: Theme.spacing.sm },
  itemPrice: { minWidth: 62, textAlign: 'right' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 8,
  },
  stepBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  /** Indented under the item it refers to, not under the block. */
  savingLine: { paddingBottom: Theme.spacing.xs, paddingRight: Theme.spacing.sm },
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
  /** Sits under the total, where the customer is already weighing the price.
   *  Tinted so it reads as an offer rather than another totals row, and faded
   *  to the right so it is not a card. See cutoffBanner. */
  saveBanner: {
    borderLeftWidth: 3,
    borderLeftColor: Theme.colors.text.mint,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
    marginTop: Theme.spacing.sm,
  },
  saveBannerCta: { textAlign: 'right', marginTop: 2 },
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
