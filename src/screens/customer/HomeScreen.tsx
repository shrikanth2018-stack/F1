/**
 * 1stOne F1 — Customer Home Screen
 */

import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  View,
  Image,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  TouchableWithoutFeedback,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { MenuItemCard } from '../../components/MenuItemCard';
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

// Static assets from Supabase Storage bucket: 'assets'
const LOGO_URL = supabase.storage.from('assets').getPublicUrl('logo.png').data.publicUrl;
const BANNER_URL = supabase.storage.from('assets').getPublicUrl('banner.png').data.publicUrl;
import type { MenuItem, EssentialItem, DeliveryCycle } from '../../types';

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

// ── Cycle detail popup ────────────────────────────────────────

function CyclePopup({
  cycle,
  onClose,
}: {
  cycle: SectionMeta;
  onClose: () => void;
}) {
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
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  box: {
    position: 'absolute',
    alignSelf: 'center',
    top: '40%',
    width: 260,
    backgroundColor: 'rgba(28,28,30,0.95)',
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  title: {
    marginBottom: Theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.xs,
  },
  closeBtn: {
    marginTop: Theme.spacing.sm,
    alignItems: 'center',
  },
});

// ── Offer Banner (reads from banners table, falls back to storage) ──
function OfferBanner() {
  const { data: liveBanner } = useLiveBanner();
  const [staticError, setStaticError] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const content: CustomBannerContent | null = useMemo(() => {
    if (liveBanner?.banner_type === 'text' && liveBanner.text_content) {
      try { return JSON.parse(liveBanner.text_content); } catch { return null; }
    }
    return null;
  }, [liveBanner]);

  useEffect(() => {
    if (content?.pulse) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [content?.pulse]);

  // Custom text banner
  if (content) {
    return (
      <Animated.View
        style={[
          bannerStyles.wrap,
          { backgroundColor: content.bg_color, opacity: pulseAnim },
        ]}
      >
        {!!content.emoji && (
          <ThemedText variant="body" color="primary" style={bannerStyles.emoji}>
            {content.emoji}
          </ThemedText>
        )}
        <ThemedText
          variant="header"
          color="primary"
          style={[bannerStyles.title, { color: content.text_color }]}
          numberOfLines={2}
        >
          {content.title}
        </ThemedText>
        {!!content.subtitle && (
          <ThemedText
            variant="small"
            color="muted"
            style={[bannerStyles.sub, { color: content.text_color, opacity: 0.85 }]}
            numberOfLines={1}
          >
            {content.subtitle}
          </ThemedText>
        )}
      </Animated.View>
    );
  }

  // Image banner — prefer live record URL, else static bucket URL
  const imageUrl = liveBanner?.banner_type === 'image' && liveBanner.image_url
    ? liveBanner.image_url
    : BANNER_URL;

  if (staticError) return null;

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
  wrap: {
    width: '100%',
    height: 130,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
  },
  img: { width: '100%', height: 130 },
  emoji: { fontSize: 26, marginBottom: 2 },
  title: { fontSize: Theme.typography.sizes.body + 6, fontWeight: '700', textAlign: 'center' },
  sub: { fontSize: Theme.typography.sizes.small + 2, textAlign: 'center', marginTop: 2 },
});

// ── Main screen ───────────────────────────────────────────────

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [popupCycle, setPopupCycle] = useState<SectionMeta | null>(null);
  const [logoError, setLogoError] = useState(false);

  const activeHomeTab = useUIStore((s) => s.activeHomeTab);
  const setActiveHomeTab = useUIStore((s) => s.setActiveHomeTab);
  const isProfileVisible = useUIStore((s) => s.isProfileVisible);
  const setProfileVisible = useUIStore((s) => s.setProfileVisible);

  const essentialsEnabled = useFeatureFlag('essentials_module');

  const { data: cycles, isLoading: cyclesLoading, isError: cyclesError, refetch: refetchCycles } = useDeliveryCycles();
  const cycleIds = useMemo(
    () => (cycles && cycles.length > 0 ? cycles.map((c) => c.id) : undefined),
    [cycles]
  );
  const { data: allMenuItems, isLoading: menuLoading, isError: menuError, refetch: refetchMenu } = useMenuItems(cycleIds);
  const { data: essentials, isLoading: essentialsLoading, refetch: refetchEssentials } = useEssentialsCatalog();
  const { evaluations } = useSmartCart();

  const foodCycles = useMemo(
    () => sortByCutoff((cycles ?? []).filter((c) => !c.is_essentials)),
    [cycles]
  );
  const essentialsCycles = useMemo(
    () => sortByCutoff((cycles ?? []).filter((c) => c.is_essentials)),
    [cycles]
  );
  const foodSections = useMemo(() => buildSections(allMenuItems ?? [], foodCycles), [allMenuItems, foodCycles]);
  const essentialsSections = useMemo(() => buildSections(essentials ?? [], essentialsCycles), [essentials, essentialsCycles]);

  // Food cart
  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const cartItems = useCartStore((s) => s.items);

  // Essentials cart
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

  const renderMenuItem = useCallback(({ item }: { item: MenuItem }) => {
    const qty = getItemQty(item.id);
    const dispatch = getDispatchInfo(item.id);
    return (
      <MenuItemCard
        item={item}
        quantity={qty}
        dispatchLabel={dispatch?.dispatch_label}
        dispatchScenario={dispatch?.scenario}
        onAdd={() => addItem({ menu_item_id: item.id, cycle_id: item.cycle_id, name: item.name, display_price: item.price })}
        onIncrement={() => updateQuantity(item.id, qty + 1)}
        onDecrement={() => qty <= 1 ? removeItem(item.id) : updateQuantity(item.id, qty - 1)}
      />
    );
  }, [getItemQty, getDispatchInfo, addItem, updateQuantity, removeItem]);

  const renderEssentialItem = useCallback(({ item }: { item: EssentialItem }) => {
    const qty = getEssentialQty(item.id);
    return (
      <View style={styles.itemRow}>
        <View style={styles.colName}>
          <ThemedText variant="body" color="primary">{item.name}</ThemedText>
          {item.description ? <ThemedText variant="small" color="muted">{item.description}</ThemedText> : null}
        </View>
        <View style={styles.colPrice}>
          <ThemedText variant="body" color="mint">{formatPriceShort(item.price)}</ThemedText>
        </View>
        <View style={styles.colAction}>
          {qty === 0 ? (
            <TouchableOpacity
              onPress={() => addEssential({ essential_item_id: item.id, cycle_id: item.cycle_id, name: item.name, display_price: item.price, unit: item.unit })}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <ThemedText variant="small" style={styles.green}>ADD</ThemedText>
            </TouchableOpacity>
          ) : (
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => qty <= 1 ? removeEssential(item.id) : updateEssential(item.id, qty - 1)} activeOpacity={0.6}>
                <ThemedText variant="body" style={styles.green}>−</ThemedText>
              </TouchableOpacity>
              <ThemedText variant="body" color="primary" style={styles.qty}>{qty}</ThemedText>
              <TouchableOpacity style={styles.stepBtn} onPress={() => updateEssential(item.id, qty + 1)} activeOpacity={0.6}>
                <ThemedText variant="body" style={styles.green}>+</ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  }, [getEssentialQty, addEssential, updateEssential, removeEssential]);

  const renderSectionHeader = useCallback(({ section }: { section: SectionMeta & { data: any[] } }) => (
    <View style={styles.sectionHeader}>
      <ThemedText variant="subtitle" color="mint" style={styles.sectionTitle}>
        {section.title}
      </ThemedText>
      <TouchableOpacity
        onPress={() => setPopupCycle({ title: section.title, deliveryBy: section.deliveryBy, cutoffTime: section.cutoffTime, cycleId: section.cycleId })}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <ThemedText variant="small" color="muted">
          Dispatch by {section.deliveryBy} ›
        </ThemedText>
      </TouchableOpacity>
    </View>
  ), []);

  const isRefreshing = cyclesLoading || menuLoading || essentialsLoading;
  const isError = cyclesError || menuError;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoWrap}>
          {logoError ? (
            <ThemedText variant="header" color="primary">1stOne</ThemedText>
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
          <ThemedText variant="body" color="primary">{'\u{1F464}'}</ThemedText>
        </TouchableOpacity>
      </View>

      <View style={styles.hairline} />

      {/* Offer banner — live from banners table, falls back to assets/banner.png */}
      <OfferBanner />

      {isError && !isRefreshing && (
        <ErrorRetry message="Failed to load menu" onRetry={handleRefresh} />
      )}

      {/* Toggle — text only, subtitle size */}
      <View style={styles.toggleRow}>
        <TouchableOpacity style={styles.togglePill} activeOpacity={0.7} onPress={() => setActiveHomeTab('food')}>
          <ThemedText
            variant="subtitle"
            color={activeHomeTab === 'food' ? 'primary' : 'muted'}
            style={activeHomeTab === 'food' ? styles.tabActive : undefined}
          >
            Food
          </ThemedText>
        </TouchableOpacity>
        {essentialsEnabled && (
          <TouchableOpacity style={styles.togglePill} activeOpacity={0.7} onPress={() => setActiveHomeTab('essentials')}>
            <ThemedText
              variant="subtitle"
              color={activeHomeTab === 'essentials' ? 'primary' : 'muted'}
              style={activeHomeTab === 'essentials' ? styles.tabActive : undefined}
            >
              Essentials
            </ThemedText>
          </TouchableOpacity>
        )}
      </View>

      {/* Scrollable content area — must be a View with flex:1 wrapping the lists;
          setting flex:1 directly on SectionList is unreliable on iOS */}
      <View style={styles.list}>
        {activeHomeTab === 'food' && (
          <SectionList
            sections={foodSections}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderMenuItem}
            renderSectionHeader={renderSectionHeader}
            contentContainerStyle={styles.listContent}
            stickySectionHeadersEnabled={false}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={Theme.colors.action.primary} />}
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
            refreshControl={<RefreshControl refreshing={essentialsLoading} onRefresh={refetchEssentials} tintColor={Theme.colors.action.primary} />}
            ListEmptyComponent={!essentialsLoading ? <EmptyState title="No essentials available" subtitle="Check back soon" /> : null}
          />
        )}
      </View>

      {isProfileVisible && <ProfilePopup />}

      {popupCycle && <CyclePopup cycle={popupCycle} onClose={() => setPopupCycle(null)} />}

      <View style={styles.hairline} />

      {/* Bottom bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom || Theme.spacing.sm }]}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('Plans')} style={styles.subsTouch}>
          <ThemedText variant="body" color="accent" style={styles.subsText}>SUBSCRIPTION PLANS</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Cart FAB — sibling to layout so it doesn't block list scroll */}
      <CartFloatingButton cartType={activeHomeTab} onPress={() => navigation.navigate('Cart')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.xs,
    paddingBottom: Theme.spacing.sm,
    marginBottom: 1,
  },
  logoWrap: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  logo: {
    height: 72,
    width: 160,
  },
  offerBanner: {
    width: '100%',
    height: 130,
    marginBottom: Theme.spacing.sm,
  },
  profileBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Theme.colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Text-only toggle — no pill shape, just a faint row background
  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
  },
  togglePill: {
    flex: 1,
    paddingVertical: Theme.spacing.sm,
    alignItems: 'center',
  },
  tabActive: {
    fontSize: Theme.typography.sizes.subtitle + 2,
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 80,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
    backgroundColor: Theme.colors.background.primary,
  },
  sectionTitle: {
    fontSize: Theme.typography.sizes.subtitle + 2,
  },
  // Item row — 3 columns
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  colName: { flex: 3 },
  colPrice: { flex: 2, alignItems: 'center' },
  colAction: { flex: 1.5, alignItems: 'flex-end' },
  green: { color: Theme.colors.status.success },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: { padding: Theme.spacing.xs },
  qty: { minWidth: 22, textAlign: 'center' },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.text.mint,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    backgroundColor: Theme.colors.background.primary,
  },
  subsTouch: {
    flex: 1,
    alignItems: 'center',
  },
  subsText: {
    fontSize: Theme.typography.sizes.body + 2,
  },
});
