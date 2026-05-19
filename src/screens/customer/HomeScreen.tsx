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
import ReAnimated, {
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
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useEssentialsCatalog } from '../../hooks/useEssentials';
import { useEssentialsCartStore } from '../../store/essentialsCartStore';
import { useCartStore } from '../../store/cartStore';
import { useUIStore } from '../../store/uiStore';
import { SegmentedControl } from '../../components/SegmentedControl';
import { assetUrl } from '../../utils/assets';
import { useLiveBanner, type CustomBannerContent } from '../../hooks/useBanner';
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

const LOGO_URL = assetUrl('logo.png');
const BANNER_URL = assetUrl('banner.png');

const { height: SCREEN_H } = Dimensions.get('window');
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

  // Scroll each tab to top whenever it becomes active
  useEffect(() => {
    if (activeHomeTab === 'food') {
      foodScrollRef.current?.scrollTo({ y: 0, animated: false });
    } else {
      essentialsScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [activeHomeTab]);

  const essentialsEnabled = useFeatureFlag('essentials_module_active', true);
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

  const textContent: CustomBannerContent | null = useMemo(() => {
    if (liveBanner?.banner_type === 'text' && liveBanner.text_content) {
      try { return JSON.parse(liveBanner.text_content); } catch { return null; }
    }
    return null;
  }, [liveBanner]);

  const heroBgUrl = (liveBanner?.banner_type === 'image' && liveBanner.image_url)
    ? liveBanner.image_url
    : BANNER_URL;

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

  const essentialsCart = useEssentialsCartStore((s) => s.items);
  const addEssential = useEssentialsCartStore((s) => s.addItem);
  const updateEssential = useEssentialsCartStore((s) => s.updateQuantity);
  const removeEssential = useEssentialsCartStore((s) => s.removeItem);

  const getItemQty = useCallback(
    (id: number) => cartItems.find((i) => i.menu_item_id === id)?.quantity ?? 0,
    [cartItems]
  );
  const getDispatchInfo = useCallback(
    (id: number) => evaluations.find((e) => e.menu_item_id === id),
    [evaluations]
  );
  const getEssentialQty = useCallback(
    (id: number) => essentialsCart.find((i) => i.essential_item_id === id)?.quantity ?? 0,
    [essentialsCart]
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
          <ReAnimated.View
            style={[
              styles.textBanner,
              { backgroundColor: textContent.bg_color },
              pulseStyle,
            ]}
          >
            {!!textContent.emoji && <Text style={styles.bannerEmoji}>{textContent.emoji}</Text>}
            <Text style={[styles.bannerTitle, { color: textContent.text_color }]} numberOfLines={2}>
              {textContent.title}
            </Text>
            {!!textContent.subtitle && (
              <Text style={[styles.bannerSub, { color: textContent.text_color }]} numberOfLines={1}>
                {textContent.subtitle}
              </Text>
            )}
          </ReAnimated.View>
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

      {/* ── Food | Essentials — shared glass pill (D24) ── */}
      {essentialsEnabled && (
        <SegmentedControl
          style={styles.pill}
          value={activeHomeTab}
          onChange={setActiveHomeTab}
          options={[
            { key: 'food', label: 'Food' },
            { key: 'essentials', label: 'Essentials' },
          ]}
        />
      )}

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
                  onAdd={() => addItem({ menu_item_id: item.id, cycle_id: item.cycle_id, name: item.name, display_price: item.price })}
                  onIncrement={() => updateQuantity(item.id, qty + 1)}
                  onDecrement={() => qty <= 1 ? removeItem(item.id) : updateQuantity(item.id, qty - 1)}
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
                    onAdd={() => addEssential({ essential_item_id: item.id, cycle_id: item.cycle_id, name: item.name, display_price: item.price, unit: item.unit })}
                    onIncrement={() => updateEssential(item.id, qty + 1)}
                    onDecrement={() => qty <= 1 ? removeEssential(item.id) : updateEssential(item.id, qty - 1)}
                  />
                );
              })}
            </CycleGroup>
          ))}
        </ScrollView>
      )}

      {/* ── Floating subscription plans button ──────────── */}
      <View style={[styles.subsBar, { bottom: (insets.bottom || 0) + Theme.spacing.sm }]}>
        <TouchableOpacity
          style={styles.subsBtn}
          activeOpacity={0.75}
          onPress={() => navigation.navigate('Plans', { initialTab: activeHomeTab })}
        >
          <Text style={styles.subsText}>Subscription Plans</Text>
        </TouchableOpacity>
      </View>

      {isProfileVisible && <ProfilePopup />}
      {popupCycle && <CyclePopup cycle={popupCycle} onClose={() => setPopupCycle(null)} />}
      {!stormMode && <CartFloatingButton cartType={activeHomeTab} onPress={() => navigation.navigate('Cart')} />}
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
  textBanner: {
    position: 'absolute',
    bottom: 44,
    left: Theme.spacing.md,
    right: Theme.spacing.md,
    borderRadius: 10,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    alignItems: 'center',
  },
  bannerEmoji: { fontSize: Theme.typography.sizes.body + 6, marginBottom: 2 },
  bannerTitle: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 6,
    fontWeight: '500',
    textAlign: 'center',
  },
  bannerSub: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small + 4,
    textAlign: 'center',
    marginTop: 2,
    opacity: 0.85,
  },

  // ── Food | Essentials pill (SegmentedControl) ──
  pill: {
    marginHorizontal: PILL_MX,
    marginVertical: Theme.spacing.sm,
  },

  // ── List ──
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xl * 3,
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

  // ── Floating subscription plans button ──
  subsBar: {
    position: 'absolute',
    left: PILL_MX,
    right: PILL_MX,
  },
  subsBtn: {
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subsText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.subtitle + 2,
    color: Theme.colors.text.mint,
    fontWeight: '400',
  },
});
