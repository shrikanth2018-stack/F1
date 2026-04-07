/**
 * 1stOne F1 — Subscriptions Screen
 *
 * Two sections:
 * 1. "My Subscriptions" — active/paused subs with manage buttons
 * 2. "Available Plans" — browse & subscribe
 *
 * Cycle filter pills at top (same as HomeScreen).
 */

import React, { useState } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { SubscriptionPlanCard } from '../../components/SubscriptionPlanCard';
import { DispatchBadge } from '../../components/DispatchBadge';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import {
  useSubscriptionPlans,
  useMySubscriptions,
  usePauseSubscription,
} from '../../hooks/useSubscriptions';
import { formatPriceShort, formatDateShort } from '../../utils/formatters';
import type { UserSubscription } from '../../types';

type TabView = 'plans' | 'mine';

export function SubscriptionsScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState<TabView>('plans');
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);

  const { data: cycles } = useDeliveryCycles();
  const { data: plans, isLoading: plansLoading, refetch: refetchPlans } = useSubscriptionPlans(selectedCycleId);
  const { data: mySubs, isLoading: subsLoading, refetch: refetchSubs } = useMySubscriptions();
  const { mutateAsync: togglePause } = usePauseSubscription();

  const handleRefresh = () => {
    refetchPlans();
    refetchSubs();
  };

  const renderMySubscription = ({ item }: { item: any }) => {
    const sub = item as UserSubscription & {
      subscription_plans?: { plan_name: string; duration_days: number; cycle_id: number; price: number };
    };
    const plan = sub.subscription_plans;
    const isActive = sub.is_active && !sub.is_paused;
    const isPaused = sub.is_paused;

    return (
      <TouchableOpacity
        style={styles.subCard}
        activeOpacity={0.7}
        onPress={() =>
          navigation.navigate('SubscriptionDetail', { subscriptionId: sub.id })
        }
      >
        <View style={styles.subTop}>
          <ThemedText variant="body" color="primary">
            {plan?.plan_name ?? `Plan #${sub.plan_id}`}
          </ThemedText>
          <DispatchBadge
            label={isPaused ? 'Paused' : isActive ? 'Active' : 'Ended'}
            variant={isPaused ? 'warning' : isActive ? 'success' : 'info'}
          />
        </View>

        <ThemedText variant="small" color="subtitle">
          Started {formatDateShort(sub.start_date)} · Day {sub.days_consumed}/{plan?.duration_days ?? '?'}
        </ThemedText>

        <View style={styles.subActions}>
          {sub.is_active && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => togglePause({ id: sub.id, pause: !sub.is_paused })}
            >
              <ThemedText variant="small" color="accent">
                {isPaused ? 'Resume' : 'Pause'}
              </ThemedText>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() =>
              navigation.navigate('SubscriptionDetail', { subscriptionId: sub.id })
            }
          >
            <ThemedText variant="small" color="accent">
              Calendar
            </ThemedText>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <ThemedText variant="header" color="primary">
          Subscriptions
        </ThemedText>
      </View>

      {/* Tab Toggle */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'plans' && styles.tabActive]}
          onPress={() => setActiveTab('plans')}
        >
          <ThemedText
            variant="small"
            color={activeTab === 'plans' ? 'primary' : 'muted'}
          >
            Available Plans
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'mine' && styles.tabActive]}
          onPress={() => setActiveTab('mine')}
        >
          <ThemedText
            variant="small"
            color={activeTab === 'mine' ? 'primary' : 'muted'}
          >
            My Subscriptions
          </ThemedText>
        </TouchableOpacity>
      </View>

      {activeTab === 'plans' ? (
        <>
          {/* Cycle Filter */}
          {cycles && cycles.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.cycleScroll}
              contentContainerStyle={styles.cycleContent}
            >
              <TouchableOpacity
                style={[styles.cyclePill, !selectedCycleId && styles.cyclePillActive]}
                onPress={() => setSelectedCycleId(null)}
              >
                <ThemedText variant="micro" color={!selectedCycleId ? 'primary' : 'muted'}>
                  All
                </ThemedText>
              </TouchableOpacity>
              {cycles.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.cyclePill,
                    selectedCycleId === c.id && styles.cyclePillActive,
                  ]}
                  onPress={() => setSelectedCycleId(c.id)}
                >
                  <ThemedText
                    variant="micro"
                    color={selectedCycleId === c.id ? 'primary' : 'muted'}
                  >
                    {c.cycle_name}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Plans List */}
          <FlatList
            data={plans ?? []}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <SubscriptionPlanCard
                plan={item}
                onPress={() =>
                  navigation.navigate('PlanDetail', { planId: item.id })
                }
              />
            )}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={plansLoading}
                onRefresh={handleRefresh}
                tintColor={Theme.colors.action.primary}
              />
            }
            ListEmptyComponent={
              !plansLoading ? (
                <EmptyState title="No plans available" subtitle="Check back soon" />
              ) : null
            }
          />
        </>
      ) : (
        <FlatList
          data={mySubs ?? []}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderMySubscription}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={subsLoading}
              onRefresh={handleRefresh}
              tintColor={Theme.colors.action.primary}
            />
          }
          ListEmptyComponent={
            !subsLoading ? (
              <EmptyState
                title="No active subscriptions"
                subtitle="Subscribe to a meal plan and save"
                actionLabel="Browse Plans"
                onAction={() => setActiveTab('plans')}
              />
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: Theme.colors.background.card,
  },
  tabActive: {
    backgroundColor: Theme.colors.action.primary,
  },
  cycleScroll: {
    maxHeight: 40,
    marginBottom: Theme.spacing.xs,
  },
  cycleContent: {
    paddingHorizontal: Theme.spacing.md,
    gap: 8,
  },
  cyclePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Theme.colors.background.card,
    marginRight: 6,
  },
  cyclePillActive: {
    backgroundColor: Theme.colors.action.primary,
  },
  listContent: {
    paddingBottom: Theme.spacing.xl,
  },
  subCard: {
    backgroundColor: Theme.colors.background.card,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  subTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  subActions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: Theme.spacing.sm,
  },
  actionBtn: {
    paddingVertical: 4,
  },
});
