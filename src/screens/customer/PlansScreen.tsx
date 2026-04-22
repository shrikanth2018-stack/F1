/**
 * 1stOne F1 — PlansScreen
 *
 * Opened from HomeScreen footer "SUBSCRIPTION PLANS".
 * Two tabs: Food | Essentials.
 * Each tab shows plans grouped by cycle as text rows.
 * ADD → PlanDetail (subscribe flow).
 *
 * My Subscriptions lives separately under ProfilePopup → Subscriptions.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useSubscriptionPlans } from '../../hooks/useSubscriptions';
import { formatPriceShort } from '../../utils/formatters';
import type { SubscriptionPlan } from '../../types';

type PlanTab = 'food' | 'essentials';

interface PlanSection {
  title: string;
  data: SubscriptionPlan[];
}

export function PlansScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState<PlanTab>('food');

  const { data: cycles, refetch: refetchCycles } = useDeliveryCycles();
  const { data: plans, isLoading, refetch: refetchPlans } = useSubscriptionPlans();

  const handleRefresh = () => { refetchCycles(); refetchPlans(); };

  const foodSections = useMemo<PlanSection[]>(() => {
    if (!cycles || !plans) return [];
    return cycles
      .filter((c) => !c.is_essentials)
      .map((c) => ({
        title: c.cycle_name,
        data: plans.filter((p) => p.cycle_id === c.id),
      }))
      .filter((s) => s.data.length > 0);
  }, [cycles, plans]);

  const essentialsSections = useMemo<PlanSection[]>(() => {
    if (!cycles || !plans) return [];
    return cycles
      .filter((c) => c.is_essentials)
      .map((c) => ({
        title: c.cycle_name,
        data: plans.filter((p) => p.cycle_id === c.id),
      }))
      .filter((s) => s.data.length > 0);
  }, [cycles, plans]);

  const activeSections = activeTab === 'food' ? foodSections : essentialsSections;

  const renderSectionHeader = ({ section }: { section: PlanSection }) => (
    <View style={styles.sectionHeader}>
      <ThemedText variant="subtitle" color="mint" style={styles.sectionTitle}>
        {section.title}
      </ThemedText>
    </View>
  );

  const renderPlan = ({ item }: { item: SubscriptionPlan }) => {
    const subtext = [
      `${item.duration_days} days`,
      item.savings_amount > 0 ? `Save ${formatPriceShort(item.savings_amount)}` : null,
    ].filter(Boolean).join(' · ');

    return (
      <View style={styles.planRow}>
        <View style={styles.colName}>
          <ThemedText variant="body" color="primary" style={styles.planName}>{item.plan_name}</ThemedText>
          <ThemedText variant="small" color="muted" style={styles.planSub}>{subtext}</ThemedText>
        </View>
        <View style={styles.colPrice}>
          <ThemedText variant="body" color="mint" style={styles.planPrice}>{formatPriceShort(item.price)}</ThemedText>
        </View>
        <View style={styles.colAction}>
          <TouchableOpacity
            onPress={() => navigation.navigate('PlanDetail', { planId: item.id })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.6}
          >
            <ThemedText variant="small" style={styles.green}>ADD</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="accent" style={styles.backText}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Subscription Plans</ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {/* Food | Essentials toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={styles.togglePill}
          activeOpacity={0.7}
          onPress={() => setActiveTab('food')}
        >
          <ThemedText variant="subtitle" color={activeTab === 'food' ? 'primary' : 'muted'}>
            Food
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.togglePill}
          activeOpacity={0.7}
          onPress={() => setActiveTab('essentials')}
        >
          <ThemedText variant="subtitle" color={activeTab === 'essentials' ? 'primary' : 'muted'}>
            Essentials
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Plans list */}
      <View style={styles.listWrap}>
        <SectionList
          sections={activeSections}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderPlan}
          renderSectionHeader={renderSectionHeader}
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
  headerSpacer: { width: 48 },
  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    overflow: 'hidden',
  },
  togglePill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listWrap: { flex: 1 },
  listContent: { paddingBottom: Theme.spacing.xl },
  sectionHeader: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
    backgroundColor: Theme.colors.background.primary,
  },
  sectionTitle: {
    fontSize: Theme.typography.sizes.subtitle + 2,
  },
  planRow: {
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
  green: { color: Theme.colors.status.success, fontSize: Theme.typography.sizes.small + 2 },
  backText: { fontSize: Theme.typography.sizes.body + 2 },
  planName: { fontSize: Theme.typography.sizes.body + 2 },
  planSub: { fontSize: Theme.typography.sizes.small + 2 },
  planPrice: { fontSize: Theme.typography.sizes.body + 2 },
});
