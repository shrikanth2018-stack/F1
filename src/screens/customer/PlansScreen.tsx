/**
 * 1stOne F1 — PlansScreen
 *
 * Opened from HomeScreen footer "SUBSCRIPTION PLANS".
 * Two tabs: Food | Essentials.
 * Each tab shows plans grouped by cycle as text rows.
 *
 * BUY → navigates to PlanDetail (structured view + calendar). PlanDetail owns
 * the conflict check and the cart write; PlansScreen is purely a listing/router.
 * Row body is not tappable; only the BUY button acts.
 *
 * My Subscriptions lives separately under ProfilePopup → Subscriptions.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useSubscriptionPlans } from '../../hooks/useSubscriptions';
import { formatPriceShort } from '../../utils/formatters';
import { essentialsCycleLabel } from '../../utils/cycleLabels';
import type { SubscriptionPlan } from '../../types';

const { width: SCREEN_W } = Dimensions.get('window');
const PILL_MX = Theme.spacing.md;
const PILL_W = SCREEN_W - PILL_MX * 2;
const TAB_W = PILL_W / 2;

type PlanTab = 'food' | 'essentials';

interface PlanSection {
  title: string;
  dispatchLabel: string | null;
  data: SubscriptionPlan[];
}

/**
 * Build "Dispatched every {morning|afternoon|evening} at H:MM AM/PM" from a
 * cycle.delivery_start string ("HH:MM:SS" or "HH:MM"). Returns null on bad input.
 */
/** Faded mint gradient hairline between rows. Mirrors HomeScreen's GradientSep. */
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

function dispatchLabelFor(timeStr: string | null | undefined): string | null {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  const hh = Number(parts[0]);
  const mm = Number(parts[1] ?? 0);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const tod = hh < 12 ? 'morning' : hh < 17 ? 'afternoon' : 'evening';
  const period = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const minutes = String(mm).padStart(2, '0');
  return `Dispatched every ${tod} at ${h12}:${minutes} ${period}`;
}

export function PlansScreen({ navigation, route }: any) {
  const initialTab: PlanTab = route?.params?.initialTab === 'essentials' ? 'essentials' : 'food';
  const [activeTab, setActiveTab] = useState<PlanTab>(initialTab);
  const insets = useSafeAreaInsets();

  const handleClose = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  const { data: cycles, refetch: refetchCycles } = useDeliveryCycles();
  const { data: plans, isLoading, refetch: refetchPlans } = useSubscriptionPlans();

  const handleRefresh = () => { refetchCycles(); refetchPlans(); };

  // Food: all 4 cycles; plans scoped by plan_type='food'
  const foodSections = useMemo<PlanSection[]>(() => {
    if (!cycles || !plans) return [];
    return cycles
      .map((c) => ({
        title: c.cycle_name,
        dispatchLabel: dispatchLabelFor(c.delivery_start),
        data: plans.filter((p) => p.cycle_id === c.id && (p.plan_type ?? 'food') === 'food'),
      }))
      .filter((s) => s.data.length > 0);
  }, [cycles, plans]);

  // Essentials: only cycles flagged is_essentials; plans scoped by plan_type='essentials';
  // section title is relabeled Morning/Noon/Evening via the cycle-label helper.
  const essentialsSections = useMemo<PlanSection[]>(() => {
    if (!cycles || !plans) return [];
    return cycles
      .filter((c) => c.is_essentials)
      .map((c) => ({
        title: essentialsCycleLabel(c),
        dispatchLabel: dispatchLabelFor(c.delivery_start),
        data: plans.filter((p) => p.cycle_id === c.id && p.plan_type === 'essentials'),
      }))
      .filter((s) => s.data.length > 0);
  }, [cycles, plans]);

  const activeSections = activeTab === 'food' ? foodSections : essentialsSections;

  // Sliding pill indicator + spring-up entrance (mirrors HomeScreen toggle)
  const tabPos = useSharedValue(initialTab === 'food' ? 0 : 1);
  useEffect(() => {
    tabPos.value = withSpring(activeTab === 'food' ? 0 : 1, { damping: 20, stiffness: 280, mass: 0.7 });
  }, [activeTab]);
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tabPos.value * TAB_W }],
  }));

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

  const renderSectionHeader = ({ section }: { section: PlanSection }) => (
    <View style={styles.sectionHeader}>
      <ThemedText variant="subtitle" color="mint" style={styles.sectionTitle}>
        {section.title}
      </ThemedText>
      {section.dispatchLabel ? (
        <ThemedText variant="small" color="muted" style={styles.sectionDispatch}>
          {section.dispatchLabel}
        </ThemedText>
      ) : null}
    </View>
  );

  const renderPlan = ({ item }: { item: SubscriptionPlan }) => {
    const iconName = item.plan_type === 'essentials' ? 'basket-outline' : 'restaurant-outline';

    return (
      <View style={styles.planRow}>
        <Ionicons name={iconName} size={17} color={Theme.colors.text.mint} style={styles.rowIcon} />
        <View style={styles.colName}>
          <ThemedText variant="body" color="primary" style={styles.planName}>{item.plan_name}</ThemedText>
        </View>
        <ThemedText variant="body" color="mint" style={styles.planPrice}>{formatPriceShort(item.price)}</ThemedText>
        <TouchableOpacity
          onPress={() => navigation.navigate('PlanDetail', { planId: item.id })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.6}
          style={styles.buyCircle}
        >
          <ThemedText variant="body" style={styles.buyChevron}>›</ThemedText>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header — title only; close moved to floating bottom pill */}
      <View style={styles.header}>
        <ThemedText variant="header" color="primary" style={styles.headerTitle}>Subscription Plans</ThemedText>
      </View>

      {/* Food | Essentials — glass pill toggle with spring entrance (mirrors HomeScreen) */}
      <ReAnimated.View style={[styles.pillOuter, toggleEntranceStyle]}>
        <ReAnimated.View style={[styles.pillIndicator, indicatorStyle]} />
        <TouchableOpacity style={styles.pillTab} activeOpacity={0.7} onPress={() => setActiveTab('food')}>
          <ThemedText
            variant="subtitle"
            color={activeTab === 'food' ? 'primary' : 'muted'}
            style={activeTab === 'food' ? styles.pillTabActive : styles.pillTabInactive}
          >
            Food
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pillTab} activeOpacity={0.7} onPress={() => setActiveTab('essentials')}>
          <ThemedText
            variant="subtitle"
            color={activeTab === 'essentials' ? 'primary' : 'muted'}
            style={activeTab === 'essentials' ? styles.pillTabActive : styles.pillTabInactive}
          >
            Essentials
          </ThemedText>
        </TouchableOpacity>
      </ReAnimated.View>

      {/* Plans list */}
      <View style={styles.listWrap}>
        <SectionList
          sections={activeSections}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderPlan}
          renderSectionHeader={renderSectionHeader}
          ItemSeparatorComponent={GradientSep}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={handleRefresh}
              tintColor={Theme.colors.action.primary}
            />
          }
          ListEmptyComponent={
            !isLoading ? (
              <EmptyState
                title="No plans available"
                subtitle="Check back soon"
              />
            ) : null
          }
        />
      </View>

      {/* Floating Back pill — mirrors HomeScreen's subscription-plans bar */}
      <View style={[styles.backBar, { bottom: (insets.bottom || 0) + Theme.spacing.sm }]}>
        <TouchableOpacity
          style={styles.backBtn}
          activeOpacity={0.75}
          onPress={handleClose}
        >
          <ThemedText style={styles.backBtnText}>Back</ThemedText>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  headerTitle: { flex: 1, textAlign: 'left' },
  // ── Glass pill toggle (mirrors HomeScreen) ──
  pillOuter: {
    flexDirection: 'row',
    marginHorizontal: PILL_MX,
    marginBottom: Theme.spacing.sm,
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

  listWrap: { flex: 1 },
  // Bottom padding leaves room for the floating Back pill (40px) + breathing room.
  listContent: { paddingBottom: 40 + Theme.spacing.md * 2 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
    backgroundColor: Theme.colors.background.primary,
  },
  sectionTitle: {
    fontSize: Theme.typography.sizes.subtitle + 2,
    flexShrink: 1,
  },
  sectionDispatch: {
    fontSize: Theme.typography.sizes.small + 1,
    marginLeft: Theme.spacing.sm,
    textAlign: 'right',
    flexShrink: 1,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  rowIcon: { marginRight: Theme.spacing.sm, flexShrink: 0 },
  colName: { flex: 1, marginRight: Theme.spacing.sm },
  // ── Buy chevron-circle (mirrors HomeScreen addCircle) ──
  buyCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: Theme.colors.text.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyChevron: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 6,
    color: Theme.colors.text.mint,
    fontWeight: '300',
    marginTop: -2,
  },
  planName: { fontSize: Theme.typography.sizes.body + 2 },
  planPrice: {
    fontSize: Theme.typography.sizes.body + 2,
    marginRight: Theme.spacing.md,
    flexShrink: 0,
  },

  // ── Floating Back pill (mirrors HomeScreen subsBar) ──
  backBar: {
    position: 'absolute',
    left: PILL_MX,
    right: PILL_MX,
  },
  backBtn: {
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.subtitle + 2,
    color: Theme.colors.text.mint,
    fontWeight: '400',
  },
});
