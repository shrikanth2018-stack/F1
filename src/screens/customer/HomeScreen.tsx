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
  Modal,
  TouchableWithoutFeedback,
  Animated,
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
  withSpring,
  withTiming,
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
import { formatTime12h } from '../../utils/timeEngine';
import { formatPriceShort } from '../../utils/formatters';
import { supabase } from '../../api/supabaseClient';
import { useLiveBanner, type CustomBannerContent } from '../../hooks/useBanner';
import { useWalletNudge } from '../../hooks/useWalletNudge';
import { useAddresses } from '../../hooks/useAddresses';
import { essentialsCycleLabel } from '../../utils/cycleLabels';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { usePendingRazorpayOrder, useCancelOrder } from '../../hooks/useOrders';
import { PendingPaymentBanner } from '../../components/PendingPaymentBanner';
import type { MenuItem, EssentialItem, DeliveryCycle } from '../../types';

const LOGO_URL = supabase.storage.from('assets').getPublicUrl('logo.png').data.publicUrl;
const BANNER_URL = supabase.storage.from('assets').getPublicUrl('banner.png').data.publicUrl;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const HERO_H = Math.round(SCREEN_H * 0.32);
const PILL_MX = 16;
const PILL_W = SCREEN_W - PILL_MX * 2;
const TAB_W = PILL_W / 2;

// ── Helpers ──────────────────────────────────────────────────

function timeToMinutes(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}

function sortByCutoff(cycles: DeliveryCycle[]): DeliveryCycle[] {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return [...cycles].sort((a, b) => {
    const aMin = timeToMinutes(a.cutoff_time);
    const bMin = timeToMinutes(b.cutoff_time);
    const aFuture = aMin > nowMin;
    const bFuture = bMin > nowMin;
    if (aFuture && !bFuture) return -1;
    if (!aFuture && bFuture) return 1;
    return aMin - bMin;
  });
}

interface SectionMeta {
  title: string;
  deliveryBy: string;
  cutoffTime: string;
  cycleId: number;
}

function buildSections<T extends { cycle_id: number }>(
  items: T[],
  cycles: DeliveryCycle[]
): Array<SectionMeta & { data: T[] }> {
  const grouped = new Map<number, T[]>();
  for (const item of items) {
    const list = grouped.get(item.cycle_id) ?? [];
    list.push(item);
    grouped.set(item.cycle_id, list);
  }
  return cycles
    .filter((c) => grouped.has(c.id))
    .map((cycle) => ({
      title: cycle.cycle_name,
      deliveryBy: formatTime12h(cycle.delivery_start),
      cutoffTime: formatTime12h(cycle.cutoff_time),
      cycleId: cycle.id,
      data: grouped.get(cycle.id) ?? [],
    }));
}

// ── Faded gradient separator ──────────────────────────────────

function GradientSep() {
  return (
    <LinearGradient
      colors={['transparent', Theme.colors.layout.divider, 'transparent']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={sep.line}
    />
  );
}

const sep = StyleSheet.create({
  line: { height: StyleSheet.hairlineWidth, width: '100%' },
});

// ── Cycle detail popup ────────────────────────────────────────

function CyclePopup({ cycle, onClose }: { cycle: SectionMeta; onClose: () => void }) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={popup.backdrop} />
      </TouchableWithoutFeedback>
      <View style={popup.box}>
        <ThemedText variant="subtitle" color="mint" style={popup.title}>
          {cycle.title}
        </ThemedText>
        <View style={popup.row}>
          <ThemedText variant="small" color="muted">Order cutoff</ThemedText>
          <ThemedText variant="small" color="primary">{cycle.cutoffTime}</ThemedText>
        </View>
        <View style={popup.row}>
          <ThemedText variant="small" color="muted">Dispatch by</ThemedText>
          <ThemedText variant="small" color="primary">{cycle.deliveryBy}</ThemedText>
        </View>
        <TouchableOpacity onPress={onClose} style={popup.closeBtn}>
          <ThemedText variant="small" color="muted">Close</ThemedText>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const popup = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Theme.colors.layout.overlay },
  box: {
    position: 'absolute',
    alignSelf: 'center',
    top: '40%',
    width: 260,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
    borderWidth: 0.5,
    borderColor: Theme.colors.layout.divider,
  },
  title: { marginBottom: Theme.spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Theme.spacing.xs },
  closeBtn: { marginTop: Theme.spacing.sm, alignItems: 'center' },
});

// ── Cycle Group — entrance bounce ────────────────────────────

interface CycleGroupProps {
  section: SectionMeta;
  index: number;
  onOpenPopup: (s: SectionMeta) => void;
  children: React.ReactNode;
}

function CycleGroup({ section, index, onOpenPopup, children }: CycleGroupProps) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 13,
        stiffness: 170,
        mass: 0.8,
      }).start();
    }, index * 80 + 40);
    return () => clearTimeout(t);
  }, []);

  const animated = {
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  };

  return (
    <Animated.View style={[styles.cycleGroup, animated]}>
      <View style={styles.groupLabelRow}>
        <ThemedText variant="subtitle" color="mint" style={styles.sectionTitle}>
          {section.title}
        </ThemedText>
        <TouchableOpacity
          onPress={() => onOpenPopup(section)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ThemedText variant="small" color="muted" style={styles.dispatchLink}>
            Dispatch by {section.deliveryBy} ›
          </ThemedText>
        </TouchableOpacity>
      </View>

      <View style={styles.groupContainer}>
        {children}
      </View>
    </Animated.View>
  );
}

// ── Compact food row ──────────────────────────────────────────

interface FoodRowProps {
  item: MenuItem;
  qty: number;
  dispatchLabel?: string;
  isLast: boolean;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}

function FoodRow({ item, qty, dispatchLabel, isLast, onAdd, onIncrement, onDecrement }: FoodRowProps) {
  return (
    <>
      <View style={styles.itemRow}>
        <Ionicons name="restaurant-outline" size={17} color={Theme.colors.text.mint} style={styles.rowIcon} />
        <View style={styles.itemMeta}>
          <Text style={styles.itemName}>{item.name}</Text>
          {dispatchLabel ? <Text style={styles.itemSub}>{dispatchLabel}</Text> : null}
        </View>
        <Text style={styles.itemPrice}>{formatPriceShort(item.price)}</Text>
        {qty === 0 ? (
          <TouchableOpacity style={styles.addCircle} onPress={onAdd} activeOpacity={0.6}>
            <Text style={styles.addPlus}>+</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.stepper}>
            <TouchableOpacity onPress={onDecrement} activeOpacity={0.5} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.stepperBtn}>−</Text>
            </TouchableOpacity>
            <Text style={styles.qtyText}>{qty}</Text>
            <TouchableOpacity onPress={onIncrement} activeOpacity={0.5} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.stepperBtn}>+</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {!isLast && <GradientSep />}
    </>
  );
}

// ── Compact essential row ─────────────────────────────────────

interface EssentialRowProps {
  item: EssentialItem;
  qty: number;
  isLast: boolean;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}

function EssentialRow({ item, qty, isLast, onAdd, onIncrement, onDecrement }: EssentialRowProps) {
  return (
    <>
      <View style={styles.itemRow}>
        <Ionicons name="basket-outline" size={17} color={Theme.colors.text.mint} style={styles.rowIcon} />
        <View style={styles.itemMeta}>
          <Text style={styles.itemName}>{item.name}</Text>
          {item.description ? <Text style={styles.itemSub}>{item.description}</Text> : null}
        </View>
        <Text style={styles.itemPrice}>{formatPriceShort(item.price)}</Text>
        {qty === 0 ? (
          <TouchableOpacity style={styles.addCircle} onPress={onAdd} activeOpacity={0.6}>
            <Text style={styles.addPlus}>+</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.stepper}>
            <TouchableOpacity onPress={onDecrement} activeOpacity={0.5} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.stepperBtn}>−</Text>
            </TouchableOpacity>
            <Text style={styles.qtyText}>{qty}</Text>
            <TouchableOpacity onPress={onIncrement} activeOpacity={0.5} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.stepperBtn}>+</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {!isLast && <GradientSep />}
    </>
  );
}

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

  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (textContent?.pulse) {
      const anim = Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
      ]));
      anim.start();
      return () => { anim.stop(); pulseAnim.setValue(1); };
    } else {
      pulseAnim.setValue(1);
    }
  }, [textContent?.pulse]);

  // Toggle pill sliding indicator
  const tabPos = useSharedValue(0);
  useEffect(() => {
    tabPos.value = withSpring(activeHomeTab === 'food' ? 0 : 1, { damping: 20, stiffness: 280, mass: 0.7 });
  }, [activeHomeTab]);
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tabPos.value * TAB_W }],
  }));

  // Toggle pill entrance
  const toggleY = useSharedValue(-22);
  const toggleOpacity = useSharedValue(0);
  useEffect(() => {
    toggleY.value = withSpring(0, { damping: 16, stiffness: 220, mass: 0.6 });
    toggleOpacity.value = withTiming(1, { duration: 380 });
  }, []);
  const toggleEntranceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: toggleY.value }],
    opacity: toggleOpacity.value,
  }));

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
          <Animated.View
            style={[
              styles.textBanner,
              { backgroundColor: textContent.bg_color, opacity: pulseAnim },
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
          </Animated.View>
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

      {/* ── Glass toggle pill with spring entrance ──────── */}
      {essentialsEnabled && (
        <ReAnimated.View style={[styles.pillOuter, toggleEntranceStyle]}>
          <ReAnimated.View style={[styles.pillIndicator, indicatorStyle]} />
          <TouchableOpacity style={styles.pillTab} activeOpacity={0.7} onPress={() => setActiveHomeTab('food')}>
            <ThemedText
              variant="subtitle"
              color={activeHomeTab === 'food' ? 'primary' : 'muted'}
              style={activeHomeTab === 'food' ? styles.pillTabActive : styles.pillTabInactive}
            >
              Food
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pillTab} activeOpacity={0.7} onPress={() => setActiveHomeTab('essentials')}>
            <ThemedText
              variant="subtitle"
              color={activeHomeTab === 'essentials' ? 'primary' : 'muted'}
              style={activeHomeTab === 'essentials' ? styles.pillTabActive : styles.pillTabInactive}
            >
              Essentials
            </ThemedText>
          </TouchableOpacity>
        </ReAnimated.View>
      )}

      {/* ── Food scroll (always rendered, hidden when essentials active) ── */}
      <ScrollView
        ref={foodScrollRef}
        style={[styles.list, activeHomeTab !== 'food' && { display: 'none' }]}
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

      {/* ── Essentials scroll (rendered only when feature enabled) ── */}
      {essentialsEnabled && (
        <ScrollView
          ref={essentialsScrollRef}
          style={[styles.list, activeHomeTab !== 'essentials' && { display: 'none' }]}
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

  // ── Glass pill toggle ──
  pillOuter: {
    flexDirection: 'row',
    marginHorizontal: PILL_MX,
    marginVertical: Theme.spacing.sm,
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    overflow: 'hidden',
  },
  pillIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: TAB_W,
    backgroundColor: `${Theme.colors.text.mint}22`,
    borderRadius: 20,
  },
  pillTab: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  pillTabInactive: { fontSize: Theme.typography.sizes.subtitle + 2 },
  pillTabActive: { fontSize: Theme.typography.sizes.subtitle + 4 },

  // ── List ──
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xl * 3,
  },

  // ── Cycle group ──
  cycleGroup: { marginBottom: Theme.spacing.lg },
  groupLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.xs,
    paddingBottom: Theme.spacing.xs,
  },
  sectionTitle: { fontSize: Theme.typography.sizes.subtitle + 4 },
  dispatchLink: { fontSize: Theme.typography.sizes.small + 2 },

  // No card border — items flow directly on the primary background
  groupContainer: {},

  // ── Compact item row ──
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.xs,
    paddingVertical: 11,
  },
  rowIcon: {
    marginRight: Theme.spacing.sm,
    flexShrink: 0,
  },
  itemMeta: { flex: 1, marginRight: Theme.spacing.sm },
  itemName: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 2,
    color: Theme.colors.text.primary,
    fontWeight: '400',
  },
  itemSub: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small + 2,
    color: Theme.colors.text.muted,
    marginTop: 2,
  },
  itemPrice: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 2,
    color: Theme.colors.text.mint,
    marginRight: Theme.spacing.md,
    flexShrink: 0,
  },

  // ── Outlined circle ADD button ──
  addCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: Theme.colors.text.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlus: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 4,
    color: Theme.colors.text.mint,
    fontWeight: '300',
    marginTop: -1,
  },

  // ── Borderless stepper ──
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.xs },
  stepperBtn: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.subtitle + 2,
    color: Theme.colors.text.mint,
    fontWeight: '300',
    lineHeight: Theme.typography.sizes.subtitle + 4,
    minWidth: 18,
    textAlign: 'center',
  },
  qtyText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 2,
    color: Theme.colors.text.primary,
    minWidth: 20,
    textAlign: 'center',
    fontWeight: '400',
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
