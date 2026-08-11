/**
 * 1stOne F1 — Customer Home Screen
 */

import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  View,
  Image,
  ImageBackground,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Dimensions,
  Text,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { CartFloatingButton } from '../../components/CartFloatingButton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { ProfilePopup } from '../../components/ProfilePopup';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useMenuItems } from '../../hooks/useMenuItems';
import { useSmartCart } from '../../hooks/useSmartCart';
import { useEssentialsEnabled } from '../../hooks/useEssentialsEnabled';
import { useEssentialsCatalog } from '../../hooks/useEssentials';
import { useCartStore } from '../../store/cartStore';
import { useUIStore } from '../../store/uiStore';
import { HomeTabStrip } from './components/HomeTabStrip';
import { assetUrl } from '../../utils/assets';
import { useLiveBanner, type CustomBannerContent } from '../../hooks/useBanner';
import { OfferOverlay } from '../../components/OfferOverlay';
import { useWalletNudge } from '../../hooks/useWalletNudge';
import { useAddresses } from '../../hooks/useAddresses';
import { essentialsCycleLabel } from '../../utils/cycleLabels';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { usePendingRazorpayOrder, useCancelOrder } from '../../hooks/useOrders';
import { PendingPaymentBanner } from '../../components/PendingPaymentBanner';
import { CycleGroup } from './components/CycleGroup';
import { CyclePopup } from './components/CyclePopup';
import { FoodRow, EssentialRow } from './components/ItemRows';
import { sortByCutoff, buildSections, type SectionMeta } from './components/homeShared';
import { HomeRails } from './components/HomeRails';
import { PlanBrowseRow } from './components/PlanBrowseRow';
import { useCycleDispatch } from '../../hooks/useCycleDispatch';
import { useSubscriptionPlans } from '../../hooks/useSubscriptions';
import { getDispatchLabel } from '../../utils/timeEngine';

const LOGO_URL = assetUrl('logo.png');
const BANNER_URL = assetUrl('banner.png');

const { height: SCREEN_H } = Dimensions.get('window');
/**
 * How far the build bar sits above the bottom: clear of the 56pt cart button
 * and its own bottom offset, so the two stack rather than overlap.
 */
const BUILD_BAR_LIFT = 56 + Theme.spacing.lg + Theme.spacing.sm;
const HERO_H = Math.round(SCREEN_H * 0.32);
const PILL_MX = 16;

// ── Main screen ───────────────────────────────────────────────

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [popupCycle, setPopupCycle] = useState<SectionMeta | null>(null);
  const [logoError, setLogoError] = useState(false);
  const [heroError, setHeroError] = useState(false);

  const foodScrollRef = useRef<ScrollView>(null);
  const essentialsScrollRef = useRef<ScrollView>(null);

  const activeHomeTab = useUIStore((s) => s.activeHomeTab);
  const setActiveHomeTab = useUIStore((s) => s.setActiveHomeTab);
  const isProfileVisible = useUIStore((s) => s.isProfileVisible);
  const setProfileVisible = useUIStore((s) => s.setProfileVisible);

  // Scroll each tab to top whenever it becomes active. The subscription tab
  // has no scroll ref of its own — it is a short list and always mounts fresh.
  useEffect(() => {
    if (activeHomeTab === 'food') {
      foodScrollRef.current?.scrollTo({ y: 0, animated: false });
    } else if (activeHomeTab === 'essentials') {
      essentialsScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [activeHomeTab]);

  const essentialsEnabled = useEssentialsEnabled();
  const { data: config } = useStoreConfig();
  const stormMode = config?.storm_mode_active ?? false;
  const walletNudge = useWalletNudge();
  const { data: addresses } = useAddresses();
  // Lead-capture nudge: user entered via "Enter Anyway" with an out-of-zone pin.
  // Checkout will block them until they add a serviceable address.
  const outOfZone = (addresses?.length ?? 0) > 0 && !addresses!.some((a) => a.is_serviceable);
  const { data: pendingOrders } = usePendingRazorpayOrder();
  const pendingOrder = pendingOrders?.[0] ?? null;
  const { mutate: cancelOrder } = useCancelOrder();

  const { data: liveBanner } = useLiveBanner();
  const { data: cycles, isLoading: cyclesLoading, isError: cyclesError, refetch: refetchCycles } = useDeliveryCycles();
  const cycleIds = useMemo(
    () => (cycles && cycles.length > 0 ? cycles.map((c) => c.id) : undefined),
    [cycles]
  );
  const { data: allMenuItems, isLoading: menuLoading, isError: menuError, refetch: refetchMenu } = useMenuItems(cycleIds);
  const { data: essentials, isLoading: essentialsLoading, refetch: refetchEssentials } = useEssentialsCatalog();
  const { evaluations } = useSmartCart();
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();

  // Server-derived delivery day per cycle. The device never decides this —
  // cycle-dispatch runs the same A/B/C cutoff rule the order path uses.
  const { data: dispatchByCycle } = useCycleDispatch();
  const dayLabelFor = useCallback(
    (cycleId: number) => {
      const d = dispatchByCycle?.get(cycleId);
      return d ? getDispatchLabel(d.scenario) : undefined;
    },
    [dispatchByCycle],
  );

  const textContent: CustomBannerContent | null = useMemo(() => {
    if (liveBanner?.banner_type === 'text' && liveBanner.text_content) {
      try { return JSON.parse(liveBanner.text_content); } catch { return null; }
    }
    return null;
  }, [liveBanner]);

  // The hero photo is INDEPENDENT of whether an offer is running. It used to
  // be read only when banner_type was 'image', so publishing an offer dropped
  // the admin's uploaded picture and fell back to the bundled default — the
  // offer was then composed over a photo nobody chose.
  const heroBgUrl = liveBanner?.image_url || BANNER_URL;

  const pulse = useSharedValue(1);
  useEffect(() => {
    if (textContent?.pulse) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(0.7, { duration: 800 }),
          withTiming(1, { duration: 800 }),
        ),
        -1,
      );
    } else {
      pulse.value = 1;
    }
  }, [textContent?.pulse, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));


  // Food: all 4 cycles serve food.
  // Essentials: only cycles flagged is_essentials (Breakfast/Lunch/Dinner, not Snacks).
  const foodCycles = useMemo(
    () => sortByCutoff(cycles ?? []),
    [cycles]
  );
  const essentialsCycles = useMemo(
    () => sortByCutoff((cycles ?? []).filter((c) => c.is_essentials)),
    [cycles]
  );
  const foodSections = useMemo(() => buildSections(allMenuItems ?? [], foodCycles), [allMenuItems, foodCycles]);
  // Essentials sections re-label via each cycle's admin-defined essentials_label.
  const essentialsSections = useMemo(
    () => buildSections(essentials ?? [], essentialsCycles).map((s) => {
      const cycle = essentialsCycles.find((c) => c.id === s.cycleId);
      return { ...s, title: cycle ? essentialsCycleLabel(cycle) : s.title };
    }),
    [essentials, essentialsCycles]
  );

  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const cartItems = useCartStore((s) => s.items);

  // One cart now — food and essentials are the same store, told apart by
  // item_type. The two id spaces overlap, so every lookup passes both.
  const getItemQty = useCallback(
    (id: number) =>
      cartItems.find((i) => i.item_id === id && i.item_type === 'food')?.quantity ?? 0,
    [cartItems]
  );
  const getDispatchInfo = useCallback(
    (id: number) => evaluations.find((e) => e.item_id === id && e.item_type === 'food'),
    [evaluations]
  );
  const getEssentialQty = useCallback(
    (id: number) =>
      cartItems.find((i) => i.item_id === id && i.item_type === 'essential')?.quantity ?? 0,
    [cartItems]
  );

  const handleRefresh = useCallback(() => {
    refetchCycles(); refetchMenu(); refetchEssentials();
  }, [refetchCycles, refetchMenu, refetchEssentials]);

  const isRefreshing = cyclesLoading || menuLoading || essentialsLoading;
  const isError = cyclesError || menuError;

  return (
    <View style={styles.container}>

      {/* ── Hero ─────────────────────────────────────────── */}
      <ImageBackground
        source={heroError ? undefined : { uri: heroBgUrl }}
        style={[styles.hero, { height: HERO_H }]}
        resizeMode="cover"
        onError={() => setHeroError(true)}
      >
        <LinearGradient
          colors={['transparent', `${Theme.colors.background.primary}99`, Theme.colors.background.primary]}
          locations={[0.25, 0.65, 1.0]}
          style={StyleSheet.absoluteFillObject}
        />

        {textContent && (
          <OfferOverlay content={textContent} animatedStyle={pulseStyle} />
        )}

        <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
          <View style={styles.logoWrap}>
            {logoError ? (
              <Text style={styles.logoFallback}>1stOne</Text>
            ) : (
              <Image
                source={{ uri: LOGO_URL }}
                style={styles.logo}
                resizeMode="contain"
                onError={() => setLogoError(true)}
              />
            )}
          </View>
          <TouchableOpacity style={styles.profileBtn} activeOpacity={0.7} onPress={() => setProfileVisible(true)}>
            <Ionicons name="person-outline" size={22} color={Theme.colors.text.primary} />
          </TouchableOpacity>
        </View>
      </ImageBackground>

      {/* ── Below-hero banners ──────────────────────────── */}
      {stormMode && (
        <View style={styles.stormBanner}>
          <ThemedText variant="subtitle" style={styles.stormText}>
            Deliveries paused due to adverse conditions. We'll resume shortly.
          </ThemedText>
        </View>
      )}

      {pendingOrder && (
        <PendingPaymentBanner
          order={pendingOrder}
          onViewOrder={() => navigation.navigate('Orders')}
          onDismiss={() => cancelOrder({ order_id: pendingOrder.id })}
        />
      )}

      {walletNudge.showNudge && (
        <TouchableOpacity
          style={styles.walletNudge}
          onPress={() => navigation.navigate('Wallet')}
          activeOpacity={0.8}
        >
          <ThemedText variant="small" color="primary">
            {'⚠ '}
            {`Your wallet is ₹${walletNudge.shortfall?.toFixed(0)} short for ${walletNudge.planName} renewal. `}
            <ThemedText variant="small" color="mint">Top up →</ThemedText>
          </ThemedText>
        </TouchableOpacity>
      )}

      {outOfZone && (
        <TouchableOpacity
          style={styles.walletNudge}
          onPress={() => navigation.navigate('AddAddress')}
          activeOpacity={0.8}
        >
          <ThemedText variant="small" color="primary">
            {'⚠ '}
            {`Your address is outside our delivery area — checkout is disabled. `}
            <ThemedText variant="small" color="mint">Add a valid address →</ThemedText>
          </ThemedText>
        </TouchableOpacity>
      )}

      {isError && !isRefreshing && (
        <ErrorRetry message="Failed to load menu" onRetry={handleRefresh} />
      )}

      {/* ── Food | Essentials | Subscribe — browser tabs ──
           Subscription is a SHOPPING mode here: browse and buy a NEW plan.
           A customer's existing subscriptions are on the side rails. This
           replaces the floating "Subscription Plans" button, which sat on top
           of the menu list and hid two rows.
           The active tab is the same colour as the list below it, so the two
           read as one sheet. See HomeTabStrip for why this is not the shared
           SegmentedControl. */}
      <HomeTabStrip
        style={styles.pill}
        value={activeHomeTab}
        onChange={setActiveHomeTab}
        options={
          essentialsEnabled
            ? [
                { key: 'food', label: 'Food' },
                { key: 'essentials', label: 'Essentials' },
                { key: 'subscription', label: 'Subscribe' },
              ]
            : [
                { key: 'food', label: 'Food' },
                { key: 'subscription', label: 'Subscribe' },
              ]
        }
      />

      {/* ── Food scroll — rendered only when food tab is active ── */}
      {/* (display:'none' on a sibling ScrollView claims flex space on Android,
           clipping the active list. Conditional render avoids that.) */}
      {activeHomeTab === 'food' && (
      <ScrollView
        ref={foodScrollRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={Theme.colors.action.primary}
          />
        }
      >
        {foodSections.length === 0 && !isRefreshing && (
          <EmptyState title="No items available" subtitle="Check back soon for fresh meals" />
        )}
        {foodSections.map((section, sectionIdx) => (
          <CycleGroup
            key={section.cycleId}
            section={section}
            index={sectionIdx}
            onOpenPopup={setPopupCycle}
            dayLabel={dayLabelFor(section.cycleId)}
          >
            {section.data.map((item, itemIdx) => {
              const qty = getItemQty(item.id);
              const dispatch = getDispatchInfo(item.id);
              return (
                <FoodRow
                  key={item.id}
                  item={item}
                  qty={qty}
                  dispatchLabel={dispatch?.dispatch_label}
                  isLast={itemIdx === section.data.length - 1}
                  onAdd={() => addItem({ item_id: item.id, item_type: 'food', cycle_id: item.cycle_id, name: item.name, display_price: item.price })}
                  onIncrement={() => updateQuantity(item.id, 'food', qty + 1)}
                  onDecrement={() => qty <= 1 ? removeItem(item.id, 'food') : updateQuantity(item.id, 'food', qty - 1)}
                />
              );
            })}
          </CycleGroup>
        ))}
      </ScrollView>
      )}

      {/* ── Essentials scroll — rendered only when feature enabled and tab active ── */}
      {essentialsEnabled && activeHomeTab === 'essentials' && (
        <ScrollView
          ref={essentialsScrollRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={Theme.colors.action.primary}
            />
          }
        >
          {essentialsSections.length === 0 && !essentialsLoading && (
            <EmptyState title="No essentials available" subtitle="Check back soon" />
          )}
          {essentialsSections.map((section, sectionIdx) => (
            <CycleGroup
              key={section.cycleId}
              section={section}
              index={sectionIdx}
              onOpenPopup={setPopupCycle}
            >
              {section.data.map((item, itemIdx) => {
                const qty = getEssentialQty(item.id);
                return (
                  <EssentialRow
                    key={item.id}
                    item={item}
                    qty={qty}
                    isLast={itemIdx === section.data.length - 1}
                    onAdd={() => addItem({ item_id: item.id, item_type: 'essential', cycle_id: item.cycle_id, name: item.name, display_price: item.price, unit: item.unit })}
                    onIncrement={() => updateQuantity(item.id, 'essential', qty + 1)}
                    onDecrement={() => qty <= 1 ? removeItem(item.id, 'essential') : updateQuantity(item.id, 'essential', qty - 1)}
                  />
                );
              })}
            </CycleGroup>
          ))}
        </ScrollView>
      )}

      {/* ── Subscription — browse and buy a NEW plan ────── */}
      {activeHomeTab === 'subscription' && (
        <ScrollView
          style={styles.list}
          contentContainerStyle={[styles.listContent, styles.subscribeListContent]}
          showsVerticalScrollIndicator={false}
        >
          {(plans ?? []).length === 0 && !plansLoading && (
            <EmptyState
              title="No ready-made plans yet"
              subtitle="Build your own above, or check back for plans we've put together"
            />
          )}
          {(plans ?? []).map((plan, idx) => (
            <PlanBrowseRow
              key={plan.id}
              plan={plan}
              isLast={idx === (plans ?? []).length - 1}
              onPress={() => navigation.navigate('PlanDetail', { planId: plan.id })}
            />
          ))}
        </ScrollView>
      )}

      {/* ── Build your own — floating over the Subscribe tab ──
           FULL WIDTH, and the earlier objection does not apply here. A
           full-width bar was rejected once for occluding the list, but that
           was when it sat over the food and essentials menus; this tab holds
           nothing but plans, and building one is the primary act on it.

           It STACKS ABOVE the cart button rather than replacing it. Hiding
           the cart on this tab would repeat the exact fault its own note
           records — a customer who added an idli, switched tab and saw the
           button disappear reasonably concluded they had lost it.

           A gradient rather than a solid fill so the plans stay legible as
           they scroll under, and pointerEvents="box-none" so only the bar
           takes taps — the faded area above belongs to the list. */}
      {activeHomeTab === 'subscription' && (
        <LinearGradient
          colors={['transparent', `${Theme.colors.background.primary}E6`, Theme.colors.background.primary]}
          locations={[0, 0.45, 1]}
          style={[styles.buildScrim, { paddingBottom: insets.bottom + BUILD_BAR_LIFT }]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={styles.buildOwnRow}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('CustomPlanBuilder')}
          >
            <View style={styles.flex1}>
              <ThemedText variant="subtitle" color="primary">Build your own plan</ThemedText>
              <ThemedText variant="small" color="muted" numberOfLines={1}>
                Your dishes, your length — the longer you go, the more you save
              </ThemedText>
            </View>
            <ThemedText variant="body" color="mint">›</ThemedText>
          </TouchableOpacity>
        </LinearGradient>
      )}

      {isProfileVisible && <ProfilePopup />}
      {popupCycle && <CyclePopup cycle={popupCycle} onClose={() => setPopupCycle(null)} />}
      {/* Rails render above the list but below the profile popup: they are a
          persistent affordance, not a modal. */}
      <HomeRails />
      {!stormMode && <CartFloatingButton onPress={() => navigation.navigate('Cart')} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },

  // ── Hero ──
  hero: { width: '100%', backgroundColor: Theme.colors.background.primary },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  logoWrap: { flex: 1, alignItems: 'flex-start', justifyContent: 'center' },
  logo: { height: 56, width: 140 },
  logoFallback: {
    color: Theme.colors.text.primary,
    fontSize: Theme.typography.sizes.body + 4,
    fontFamily: Theme.typography.fontFamily,
  },
  profileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.colors.layout.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Food | Essentials pill (SegmentedControl) ──
  /** No bottom margin on purpose — the active tab has to touch the list for
   *  the two to read as one sheet. */
  pill: {
    marginHorizontal: PILL_MX,
    marginTop: Theme.spacing.sm,
  },

  // ── List ──
  list: { flex: 1 },
  /** Clears the floating build bar, so the last plan is never trapped under it. */
  subscribeListContent: { paddingBottom: Theme.spacing.xl * 5 },
  listContent: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xl * 3,
  },

  flex1: { flex: 1 },
  /** Full width, fading upward so the list stays readable beneath it. */
  buildScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.md,
    justifyContent: 'flex-end',
  },
  /** Floats over the Subscribe tab — see the note at the call site. */
  buildOwnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    backgroundColor: `${Theme.colors.text.mint}0F`,
  },

  // ── Misc banners ──
  stormBanner: {
    backgroundColor: Theme.colors.status.error,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    marginHorizontal: Theme.spacing.md,
    marginTop: Theme.spacing.sm,
    borderRadius: Theme.components.inputRadius,
  },
  stormText: { color: Theme.colors.text.primary, textAlign: 'center' },
  walletNudge: {
    backgroundColor: Theme.colors.background.secondary,
    borderLeftWidth: 3,
    borderLeftColor: Theme.colors.status.warning,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    marginHorizontal: Theme.spacing.md,
    marginTop: Theme.spacing.sm,
    borderRadius: Theme.components.inputRadius,
  },

});
