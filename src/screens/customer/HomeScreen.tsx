/**
 * 1stOne F1 — Customer Home Screen (Midnight Glass)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  RefreshControl,
  SectionList,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../api/supabaseClient';
import {
  ScreenBackground,
  GlassCard,
  HapticButton,
  Heading,
  Body,
  Caption,
  MG,
} from '../../components/CustomerUI';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { ProfilePopup } from '../../components/ProfilePopup';
import { PendingPaymentBanner } from '../../components/PendingPaymentBanner';
import { DispatchBadge } from '../../components/DispatchBadge';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useMenuItems } from '../../hooks/useMenuItems';
import { useSmartCart } from '../../hooks/useSmartCart';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useEssentialsCatalog } from '../../hooks/useEssentials';
import { useEssentialsCartStore } from '../../store/essentialsCartStore';
import { useCartStore } from '../../store/cartStore';
import { useUIStore } from '../../store/uiStore';
import { useWalletBalance } from '../../hooks/useWallet';
import { useWalletNudge } from '../../hooks/useWalletNudge';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { usePendingRazorpayOrder, useCancelOrder } from '../../hooks/useOrders';
import { useLiveBanner, type CustomBannerContent } from '../../hooks/useBanner';
import { formatTime12h } from '../../utils/timeEngine';
import { formatPriceShort } from '../../utils/formatters';
import type { MenuItem, EssentialItem, DeliveryCycle } from '../../types';

const LOGO_URL = supabase.storage.from('assets').getPublicUrl('logo.png').data.publicUrl;
const BANNER_URL = supabase.storage.from('assets').getPublicUrl('banner.png').data.publicUrl;

// ── Helpers ───────────────────────────────────────────────────

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
  minutesToCutoff: number;
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
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return cycles
    .filter((c) => grouped.has(c.id))
    .map((cycle) => {
      const cutoffMin = timeToMinutes(cycle.cutoff_time);
      return {
        title: cycle.cycle_name,
        deliveryBy: formatTime12h(cycle.delivery_start),
        cutoffTime: formatTime12h(cycle.cutoff_time),
        cycleId: cycle.id,
        minutesToCutoff: Math.max(0, cutoffMin - nowMin),
        data: grouped.get(cycle.id) ?? [],
      };
    });
}

// ── Cycle detail popup ────────────────────────────────────────

function CyclePopup({ cycle, onClose }: { cycle: SectionMeta; onClose: () => void }) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={popup.backdrop} />
      </TouchableWithoutFeedback>
      <GlassCard style={popup.box} intensity={50}>
        <Body style={popup.cycleTitle}>{cycle.title}</Body>
        <View style={popup.row}>
          <Caption>Order cutoff</Caption>
          <Caption style={{ color: MG.white }}>{cycle.cutoffTime}</Caption>
        </View>
        <View style={popup.row}>
          <Caption>Dispatch by</Caption>
          <Caption style={{ color: MG.white }}>{cycle.deliveryBy}</Caption>
        </View>
        <TouchableOpacity onPress={onClose} style={popup.closeBtn}>
          <Caption>Close</Caption>
        </TouchableOpacity>
      </GlassCard>
    </Modal>
  );
}

const popup = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  box: {
    position: 'absolute',
    alignSelf: 'center',
    top: '38%',
    width: 260,
    padding: 20,
  },
  cycleTitle: { color: MG.white, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  closeBtn: { marginTop: 12, alignItems: 'center' },
});

// ── Offer Banner ──────────────────────────────────────────────

function OfferBanner() {
  const { data: liveBanner } = useLiveBanner();
  const [staticError, setStaticError] = useState(false);
  const opacity = useSharedValue(1);

  const content: CustomBannerContent | null = useMemo(() => {
    if (liveBanner?.banner_type === 'text' && liveBanner.text_content) {
      try { return JSON.parse(liveBanner.text_content); } catch { return null; }
    }
    return null;
  }, [liveBanner]);

  useEffect(() => {
    if (content?.pulse) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.55, { duration: 800 }),
          withTiming(1, { duration: 800 }),
        ),
        -1,
        false,
      );
    } else {
      opacity.value = 1;
    }
  }, [content?.pulse]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (content) {
    return (
      <Animated.View style={[bannerStyles.textWrap, { backgroundColor: content.bg_color }, animStyle]}>
        {!!content.emoji && <Body style={bannerStyles.emoji}>{content.emoji}</Body>}
        <Body style={[bannerStyles.bannerTitle, { color: content.text_color }]} numberOfLines={2}>
          {content.title}
        </Body>
        {!!content.subtitle && (
          <Caption style={[bannerStyles.bannerSub, { color: content.text_color }]} numberOfLines={1}>
            {content.subtitle}
          </Caption>
        )}
      </Animated.View>
    );
  }

  if (staticError) return null;

  const imageUrl = liveBanner?.banner_type === 'image' && liveBanner.image_url
    ? liveBanner.image_url
    : BANNER_URL;

  return (
    <Image
      source={{ uri: imageUrl }}
      style={bannerStyles.img}
      resizeMode="cover"
      onError={() => setStaticError(true)}
    />
  );
}

const bannerStyles = StyleSheet.create({
  textWrap: { width: '100%', height: 120, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  img: { width: '100%', height: 120 },
  emoji: { fontSize: 26, marginBottom: 2 },
  bannerTitle: { fontSize: 20, textAlign: 'center', color: MG.white },
  bannerSub: { textAlign: 'center', marginTop: 2 },
});

// ── Dispatch Urgency Tag ──────────────────────────────────────

function UrgencyTag({ minutes }: { minutes: number }) {
  if (minutes <= 0 || minutes > 120) return null;
  const urgent = minutes <= 30;
  return (
    <Caption style={[urgencyStyles.tag, urgent ? urgencyStyles.red : urgencyStyles.amber]}>
      {urgent ? `Closes in ${minutes}m` : `${minutes}m left`}
    </Caption>
  );
}

const urgencyStyles = StyleSheet.create({
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', fontSize: 11 },
  amber: { backgroundColor: 'rgba(255,191,0,0.18)', color: MG.warningAmber },
  red:   { backgroundColor: 'rgba(239,68,68,0.18)',  color: MG.errorRed },
});

// ── Main screen ───────────────────────────────────────────────

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const [popupCycle, setPopupCycle] = useState<SectionMeta | null>(null);
  const [logoError, setLogoError] = useState(false);

  const activeHomeTab = useUIStore((s) => s.activeHomeTab);
  const setActiveHomeTab = useUIStore((s) => s.setActiveHomeTab);
  const isProfileVisible = useUIStore((s) => s.isProfileVisible);
  const setProfileVisible = useUIStore((s) => s.setProfileVisible);

  const essentialsEnabled = useFeatureFlag('essentials_module_active', true);
  const { data: config } = useStoreConfig();
  const stormMode = config?.storm_mode_active ?? false;
  const walletNudge = useWalletNudge();
  const { data: wallet } = useWalletBalance();
  const { data: pendingOrders } = usePendingRazorpayOrder();
  const pendingOrder = pendingOrders?.[0] ?? null;
  const { mutate: cancelOrder } = useCancelOrder();

  const { data: cycles, isLoading: cyclesLoading, isError: cyclesError, refetch: refetchCycles } = useDeliveryCycles();
  const cycleIds = useMemo(
    () => (cycles && cycles.length > 0 ? cycles.map((c) => c.id) : undefined),
    [cycles]
  );
  const { data: allMenuItems, isLoading: menuLoading, isError: menuError, refetch: refetchMenu } = useMenuItems(cycleIds);
  const { data: essentials, isLoading: essentialsLoading, refetch: refetchEssentials } = useEssentialsCatalog();
  const { evaluations } = useSmartCart();

  const foodCycles = useMemo(() => sortByCutoff((cycles ?? []).filter((c) => !c.is_essentials)), [cycles]);
  const essentialsCycles = useMemo(() => sortByCutoff((cycles ?? []).filter((c) => c.is_essentials)), [cycles]);
  const foodSections = useMemo(() => buildSections(allMenuItems ?? [], foodCycles), [allMenuItems, foodCycles]);
  const essentialsSections = useMemo(() => buildSections(essentials ?? [], essentialsCycles), [essentials, essentialsCycles]);

  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const cartItems = useCartStore((s) => s.items);

  const essentialsCart = useEssentialsCartStore((s) => s.items);
  const addEssential = useEssentialsCartStore((s) => s.addItem);
  const updateEssential = useEssentialsCartStore((s) => s.updateQuantity);
  const removeEssential = useEssentialsCartStore((s) => s.removeItem);

  const foodCartCount = cartItems.reduce((sum, i) => sum + i.quantity, 0);
  const essentialCartCount = essentialsCart.reduce((sum, i) => sum + i.quantity, 0);
  const totalCartCount = activeHomeTab === 'food' ? foodCartCount : essentialCartCount;
  const foodCartTotal = cartItems.reduce((sum, i) => sum + i.display_price * i.quantity, 0);
  const essentialCartTotal = essentialsCart.reduce((sum, i) => sum + i.display_price * i.quantity, 0);
  const cartTotal = activeHomeTab === 'food' ? foodCartTotal : essentialCartTotal;

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

  const renderMenuItem = useCallback(({ item }: { item: MenuItem }) => {
    const qty = getItemQty(item.id);
    const dispatch = getDispatchInfo(item.id);
    return (
      <GlassCard style={menuStyles.card}>
        <View style={menuStyles.row}>
          <View style={menuStyles.info}>
            <Body style={{ color: MG.white }}>{item.name}</Body>
            {item.description ? <Caption numberOfLines={1}>{item.description}</Caption> : null}
            {dispatch && (
              <DispatchBadge
                label={dispatch.dispatch_label}
                variant={dispatch.scenario === 'A' ? 'today' : 'tomorrow'}
              />
            )}
          </View>
          <View style={menuStyles.right}>
            <Body style={menuStyles.price}>{formatPriceShort(item.price)}</Body>
            {qty === 0 ? (
              <HapticButton
                style={menuStyles.addBtn}
                onPress={() => addItem({ menu_item_id: item.id, cycle_id: item.cycle_id, name: item.name, display_price: item.price })}
              >
                <Caption style={menuStyles.addText}>ADD</Caption>
              </HapticButton>
            ) : (
              <View style={menuStyles.stepper}>
                <HapticButton
                  style={menuStyles.stepBtn}
                  onPress={() => qty <= 1 ? removeItem(item.id) : updateQuantity(item.id, qty - 1)}
                >
                  <Body style={menuStyles.stepText}>−</Body>
                </HapticButton>
                <Body style={menuStyles.qty}>{qty}</Body>
                <HapticButton
                  style={menuStyles.stepBtn}
                  onPress={() => updateQuantity(item.id, qty + 1)}
                >
                  <Body style={menuStyles.stepText}>+</Body>
                </HapticButton>
              </View>
            )}
          </View>
        </View>
      </GlassCard>
    );
  }, [getItemQty, getDispatchInfo, addItem, updateQuantity, removeItem]);

  const renderEssentialItem = useCallback(({ item }: { item: EssentialItem }) => {
    const qty = getEssentialQty(item.id);
    return (
      <GlassCard style={menuStyles.card}>
        <View style={menuStyles.row}>
          <View style={menuStyles.info}>
            <Body style={{ color: MG.white }}>{item.name}</Body>
            <Caption>{item.unit}</Caption>
          </View>
          <View style={menuStyles.right}>
            <Body style={menuStyles.price}>{formatPriceShort(item.price)}</Body>
            {qty === 0 ? (
              <HapticButton
                style={menuStyles.addBtn}
                onPress={() => addEssential({ essential_item_id: item.id, cycle_id: item.cycle_id, name: item.name, display_price: item.price, unit: item.unit })}
              >
                <Caption style={menuStyles.addText}>ADD</Caption>
              </HapticButton>
            ) : (
              <View style={menuStyles.stepper}>
                <HapticButton
                  style={menuStyles.stepBtn}
                  onPress={() => qty <= 1 ? removeEssential(item.id) : updateEssential(item.id, qty - 1)}
                >
                  <Body style={menuStyles.stepText}>−</Body>
                </HapticButton>
                <Body style={menuStyles.qty}>{qty}</Body>
                <HapticButton
                  style={menuStyles.stepBtn}
                  onPress={() => updateEssential(item.id, qty + 1)}
                >
                  <Body style={menuStyles.stepText}>+</Body>
                </HapticButton>
              </View>
            )}
          </View>
        </View>
      </GlassCard>
    );
  }, [getEssentialQty, addEssential, updateEssential, removeEssential]);

  const renderSectionHeader = useCallback(({ section }: { section: SectionMeta & { data: any[] } }) => (
    <View style={sectionStyles.header}>
      <View style={sectionStyles.titleRow}>
        <Heading style={sectionStyles.title}>{section.title}</Heading>
        <UrgencyTag minutes={section.minutesToCutoff} />
      </View>
      <TouchableOpacity
        onPress={() => setPopupCycle(section)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Caption>Dispatch by {section.deliveryBy} ›</Caption>
      </TouchableOpacity>
    </View>
  ), []);

  const isRefreshing = cyclesLoading || menuLoading || essentialsLoading;
  const isError = cyclesError || menuError;

  // Top bar content
  const balanceStr = `₹${(wallet?.balance ?? 0).toLocaleString('en-IN')}`;

  return (
    <ScreenBackground>
      {/* Top bar — logo + wallet balance */}
      <GlassCard style={topStyles.bar}>
        <View style={topStyles.row}>
          <TouchableOpacity onPress={() => setProfileVisible(true)} activeOpacity={0.8} style={topStyles.logoTouch}>
            {logoError ? (
              <Heading style={topStyles.logoText}>1stOne</Heading>
            ) : (
              <Image
                source={{ uri: LOGO_URL }}
                style={topStyles.logo}
                resizeMode="contain"
                onError={() => setLogoError(true)}
              />
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Wallet')} activeOpacity={0.8} style={topStyles.walletTouch}>
            <Caption>Wallet</Caption>
            <Body style={topStyles.balance}>{balanceStr}</Body>
          </TouchableOpacity>
        </View>
      </GlassCard>

      {/* Storm mode */}
      {stormMode && (
        <GlassCard style={stormStyles.card}>
          <Body style={stormStyles.text}>
            Deliveries paused due to adverse conditions. We'll resume shortly.
          </Body>
        </GlassCard>
      )}

      {/* Offer banner */}
      {!stormMode && <OfferBanner />}

      {/* Pending payment recovery */}
      {pendingOrder && (
        <PendingPaymentBanner
          order={pendingOrder}
          onViewOrder={() => navigation.navigate('Orders')}
          onDismiss={() => cancelOrder({ order_id: pendingOrder.id })}
        />
      )}

      {/* Wallet low-balance nudge */}
      {walletNudge.showNudge && (
        <HapticButton
          style={nudgeStyles.card}
          onPress={() => navigation.navigate('Wallet')}
        >
          <Body style={nudgeStyles.text}>
            {'⚠ '}
            {`Wallet is ₹${walletNudge.shortfall?.toFixed(0)} short for ${walletNudge.planName}. `}
            <Body style={nudgeStyles.link}>Top up →</Body>
          </Body>
        </HapticButton>
      )}

      {isError && !isRefreshing && (
        <ErrorRetry message="Failed to load menu" onRetry={handleRefresh} />
      )}

      {/* Tab toggle */}
      <GlassCard style={tabStyles.bar}>
        <View style={tabStyles.row}>
          <HapticButton style={tabStyles.tab} onPress={() => setActiveHomeTab('food')}>
            <Body style={activeHomeTab === 'food' ? tabStyles.active : tabStyles.inactive}>Food</Body>
            {activeHomeTab === 'food' && <View style={tabStyles.dot} />}
          </HapticButton>
          {essentialsEnabled && (
            <HapticButton style={tabStyles.tab} onPress={() => setActiveHomeTab('essentials')}>
              <Body style={activeHomeTab === 'essentials' ? tabStyles.active : tabStyles.inactive}>Essentials</Body>
              {activeHomeTab === 'essentials' && <View style={tabStyles.dot} />}
            </HapticButton>
          )}
        </View>
      </GlassCard>

      {/* Scrollable list */}
      <View style={styles.list}>
        {activeHomeTab === 'food' && (
          <SectionList
            sections={foodSections}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderMenuItem}
            renderSectionHeader={renderSectionHeader}
            contentContainerStyle={styles.listContent}
            stickySectionHeadersEnabled={false}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={MG.neonGreen} />}
            ListEmptyComponent={!isRefreshing ? <EmptyState title="No items available" subtitle="Check back soon for fresh meals" /> : null}
          />
        )}
        {activeHomeTab === 'essentials' && essentialsEnabled && (
          <SectionList
            sections={essentialsSections}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderEssentialItem}
            renderSectionHeader={renderSectionHeader}
            contentContainerStyle={styles.listContent}
            stickySectionHeadersEnabled={false}
            refreshControl={<RefreshControl refreshing={essentialsLoading} onRefresh={refetchEssentials} tintColor={MG.neonGreen} />}
            ListEmptyComponent={!essentialsLoading ? <EmptyState title="No essentials available" subtitle="Check back soon" /> : null}
          />
        )}
      </View>

      {/* Sticky cart bar */}
      {!stormMode && totalCartCount > 0 && (
        <GlassCard style={cartStyles.bar} intensity={50}>
          <View style={cartStyles.row}>
            <View>
              <Caption>{totalCartCount} item{totalCartCount !== 1 ? 's' : ''}</Caption>
              <Body style={cartStyles.total}>{formatPriceShort(cartTotal)}</Body>
            </View>
            <HapticButton
              style={cartStyles.checkoutBtn}
              onPress={() => navigation.navigate('Cart')}

            >
              <Body style={cartStyles.checkoutText}>Checkout →</Body>
            </HapticButton>
          </View>
        </GlassCard>
      )}

      {/* Bottom bar — subscriptions link */}
      {(stormMode || totalCartCount === 0) && (
        <GlassCard style={bottomStyles.bar}>
          <HapticButton onPress={() => navigation.navigate('Plans')}>
            <Caption style={bottomStyles.link}>SUBSCRIPTION PLANS</Caption>
          </HapticButton>
        </GlassCard>
      )}

      {isProfileVisible && <ProfilePopup />}
      {popupCycle && <CyclePopup cycle={popupCycle} onClose={() => setPopupCycle(null)} />}
    </ScreenBackground>
  );
}

// ── Styles ────────────────────────────────────────────────────

const topStyles = StyleSheet.create({
  bar: { marginHorizontal: 16, marginTop: 8, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  logoTouch: { flex: 1 },
  logo: { height: 60, width: 140 },
  logoText: { fontSize: 22 },
  walletTouch: { alignItems: 'flex-end', paddingLeft: 12 },
  balance: { color: MG.neonGreen, marginTop: 2 },
});

const tabStyles = StyleSheet.create({
  bar: { marginHorizontal: 16, marginTop: 4, marginBottom: 4 },
  row: { flexDirection: 'row', padding: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  active: { color: MG.white },
  inactive: { color: MG.captionGrey },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: MG.neonGreen, marginTop: 4 },
});

const menuStyles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 8 },
  row: { flexDirection: 'row', padding: 14 },
  info: { flex: 1, marginRight: 12 },
  right: { alignItems: 'flex-end', justifyContent: 'space-between', minWidth: 72 },
  price: { color: MG.neonGreen, marginBottom: 8 },
  addBtn: {
    borderWidth: 1,
    borderColor: MG.neonGreen,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  addText: { color: MG.neonGreen },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: { padding: 6 },
  stepText: { color: MG.neonGreen },
  qty: { minWidth: 22, textAlign: 'center', color: MG.white },
});

const sectionStyles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { fontSize: 20 },
});

const stormStyles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 8 },
  text: { color: MG.errorRed, textAlign: 'center', padding: 14 },
});

const nudgeStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 4,
    borderLeftWidth: 3,
    borderLeftColor: MG.warningAmber,
    backgroundColor: 'rgba(255,191,0,0.08)',
    borderRadius: 12,
    padding: 12,
  },
  text: { color: MG.bodyGrey },
  link: { color: MG.neonGreen },
});

const cartStyles = StyleSheet.create({
  bar: { marginHorizontal: 16, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  total: { color: MG.white, marginTop: 2 },
  checkoutBtn: {
    backgroundColor: MG.neonGreen,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  checkoutText: { color: MG.black },
});

const bottomStyles = StyleSheet.create({
  bar: { marginHorizontal: 16, marginBottom: 8, alignItems: 'center', padding: 14 },
  link: { color: MG.neonGreen, textAlign: 'center' },
});

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { paddingBottom: 16 },
});
