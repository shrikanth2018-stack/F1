/**
 * 1stOne F1 — My Subscriptions Screen
 *
 * Food | Essentials tabs.
 * Flat rows: plan name + pause toggle on right.
 * Shared calendar at bottom — dots for scheduled deliveries,
 * tap a day to skip or resume that day's delivery.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
  Modal,
  TouchableWithoutFeedback,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import {
  useMySubscriptions,
  usePauseSubscription,
  useAllCancelledDays,
  useSkipDay,
  useUndoSkip,
} from '../../hooks/useSubscriptions';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { formatDateShort } from '../../utils/formatters';
import type { UserSubscription, CancelledSubscriptionDay } from '../../types';

type SubTab = 'food' | 'essentials';

// One distinct color per subscription slot
const SUB_COLORS = [
  Theme.colors.text.mint,
  Theme.colors.calendar.breakfast,
  Theme.colors.status.error,
  Theme.colors.action.primary,
  Theme.colors.calendar.snacks,
];

type EnrichedSub = UserSubscription & {
  subscription_plans?: {
    plan_name: string;
    duration_days: number;
    cycle_id: number;
    price: number;
    plan_type: 'food' | 'essential';
  };
};

/** 30 days starting from today */
function getCalendarDates(): Date[] {
  return Array.from({ length: 45 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/**
 * Returns whether a sub has a scheduled delivery on a given date.
 * Cancelled days extend the subscription end date — if 2 days are
 * skipped the sub runs 2 days longer — and are excluded as delivery days.
 */
function subDeliversOn(
  sub: EnrichedSub,
  dateStr: string,
  cancelledDays: CancelledSubscriptionDay[],
): boolean {
  if (!sub.is_active || sub.is_paused) return false;
  const duration = sub.subscription_plans?.duration_days ?? 0;
  const subCancelled = cancelledDays.filter((c) => c.subscription_id === sub.id);
  // Each skipped day pushes the end date out by 1
  const endDate = addDays(sub.start_date, duration - 1 + subCancelled.length);
  // The date must be in range but not itself a cancelled day
  const isSkipped = subCancelled.some((c) => c.cancelled_date === dateStr);
  return dateStr >= sub.start_date && dateStr <= endDate && !isSkipped;
}

export function SubscriptionsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<SubTab>('food');
  const [modalDate, setModalDate] = useState<Date | null>(null);

  const { data: rawSubs, isLoading, refetch } = useMySubscriptions();
  const { mutateAsync: togglePause } = usePauseSubscription();
  const { mutateAsync: skipDay } = useSkipDay();
  const { mutateAsync: undoSkip } = useUndoSkip();
  const { data: cycles } = useDeliveryCycles();

  const subs = (rawSubs ?? []) as EnrichedSub[];

  const foodSubs = useMemo(
    () => subs.filter((s) => s.subscription_plans?.plan_type === 'food'),
    [subs]
  );
  const essentialsSubs = useMemo(
    () => subs.filter((s) => s.subscription_plans?.plan_type === 'essential'),
    [subs]
  );
  const activeSubs = activeTab === 'food' ? foodSubs : essentialsSubs;

  const allSubIds = useMemo(() => subs.map((s) => s.id), [subs]);
  const { data: allCancelledDays, refetch: refetchCancelled } = useAllCancelledDays(allSubIds);

  const calendarDates = useMemo(() => getCalendarDates(), []);

  const handleRefresh = useCallback(() => {
    refetch();
    refetchCancelled();
  }, [refetch, refetchCancelled]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  /** All subs delivering on a given date — across ALL types (food + essentials) */
  const getDeliveryInfos = useCallback(
    (date: Date): { sub: EnrichedSub; cancelled: CancelledSubscriptionDay | undefined; color: string }[] => {
      const dateStr = toDateStr(date);
      const cancelled = allCancelledDays ?? [];
      return subs
        .map((sub, i) => ({
          sub,
          cancelled: cancelled.find(
            (c) => c.subscription_id === sub.id && c.cancelled_date === dateStr
          ),
          color: SUB_COLORS[i % SUB_COLORS.length],
        }))
        .filter(({ sub, cancelled: skippedEntry }) => {
          // Include days the sub delivers on AND days that are explicitly skipped
          // (so user can tap a skipped day and resume it)
          return subDeliversOn(sub, dateStr, cancelled) || (
            skippedEntry !== undefined && sub.is_active && !sub.is_paused
          );
        });
    },
    [subs, allCancelledDays]
  );

  const handleDayTap = useCallback((date: Date) => {
    const infos = getDeliveryInfos(date);
    if (infos.length === 0) return;
    setModalDate(date);
  }, [getDeliveryInfos]);

  const handleToggleDay = useCallback(async (
    sub: EnrichedSub,
    cancelled: CancelledSubscriptionDay | undefined,
    dateStr: string,
  ) => {
    const cycleId = (cycles ?? []).find((c) => c.id === sub.subscription_plans?.cycle_id)?.id
      ?? sub.subscription_plans?.cycle_id ?? 0;
    if (cancelled) {
      await undoSkip({ id: cancelled.id });
    } else {
      await skipDay({
        subscription_id: sub.id,
        cancelled_date: dateStr,
        cycle_id: cycleId,
        reason: 'Skipped by customer',
      });
    }
    refetchCancelled();
  }, [cycles, skipDay, undoSkip, refetchCancelled]);

  const renderSub = ({ item }: { item: EnrichedSub }) => {
    const plan = item.subscription_plans;
    const isRunning = item.is_active && !item.is_paused;
    const isPendingPayment = !item.is_active && item.payment_method === 'razorpay';

    return (
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <ThemedText variant="subtitle" color="primary">
            {plan?.plan_name ?? `Plan #${item.plan_id}`}
          </ThemedText>
          {isPendingPayment ? (
            <ThemedText variant="body" color="muted" style={styles.rowMeta}>
              Awaiting payment confirmation
            </ThemedText>
          ) : (
            <ThemedText variant="body" color="subtitle" style={styles.rowMeta}>
              Starts {formatDateShort(item.start_date)} · Day {item.days_consumed}/{plan?.duration_days ?? '?'}
            </ThemedText>
          )}
        </View>
        {item.is_active && (
          <Switch
            value={isRunning}
            onValueChange={() => { togglePause({ id: item.id, pause: isRunning }); }}
            trackColor={{
              false: Theme.colors.background.input,
              true: Theme.colors.text.mint,
            }}
            thumbColor={Theme.colors.text.primary}
          />
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="accent">‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">My Subscriptions</ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {/* Food | Essentials tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'food' && styles.tabActive]}
          onPress={() => setActiveTab('food')}
        >
          <ThemedText
            variant="body"
            color={activeTab === 'food' ? 'primary' : 'muted'}
            style={activeTab === 'food' ? styles.tabTextActive : undefined}
          >
            Food
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'essentials' && styles.tabActive]}
          onPress={() => setActiveTab('essentials')}
        >
          <ThemedText
            variant="body"
            color={activeTab === 'essentials' ? 'primary' : 'muted'}
            style={activeTab === 'essentials' ? styles.tabTextActive : undefined}
          >
            Essentials
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Subscription list — calendar appended as footer, scrolls together */}
      <FlatList
        data={activeSubs}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderSub}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
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
              title={`No ${activeTab} subscriptions`}
              subtitle="Tap Add Plan below to subscribe"
            />
          ) : null
        }
        ListFooterComponent={
          <View style={styles.calendarWrap}>
            <ThemedText variant="small" color="primary" style={styles.calendarLabel}>
              DELIVERY CALENDAR
            </ThemedText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.calendarRow}
            >
              {calendarDates.map((date) => {
                const infos = getDeliveryInfos(date);
                const activeInfos = infos.filter((i) => !i.cancelled);
                const hasAny = infos.length > 0;
                const hasActive = activeInfos.length > 0;
                const dayName = date.toLocaleDateString('en-IN', { weekday: 'short' });
                const dayNum = date.getDate();
                const month = date.toLocaleDateString('en-IN', { month: 'short' });
                const isToday = toDateStr(date) === toDateStr(new Date());

                return (
                  <TouchableOpacity
                    key={date.toISOString()}
                    style={[
                      styles.datePill,
                      isToday && styles.datePillToday,
                      hasActive && styles.datePillDelivery,
                    ]}
                    onPress={() => handleDayTap(date)}
                    activeOpacity={hasAny ? 0.7 : 1}
                  >
                    <ThemedText variant="micro" color="muted">{dayName}</ThemedText>
                    <ThemedText variant="body" color={hasActive ? 'mint' : 'primary'}>
                      {dayNum}
                    </ThemedText>
                    <ThemedText variant="micro" color="muted">{month}</ThemedText>
                    <View style={styles.dotRow}>
                      {infos.map(({ sub, cancelled: skipped, color }) => (
                        <View
                          key={sub.id}
                          style={[styles.dot, { backgroundColor: color, opacity: skipped ? 0.3 : 1 }]}
                        />
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        }
      />

      {/* Floating Add Plan button */}
      <TouchableOpacity
        style={[styles.addBtn, { bottom: insets.bottom + 16 }]}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('Plans')}
      >
        <ThemedText variant="body" style={styles.addBtnText}>+ Add Plan</ThemedText>
        <ThemedText variant="body" style={styles.addBtnText}>›</ThemedText>
      </TouchableOpacity>

      {/* Day detail modal */}
      {modalDate && (() => {
        const dateStr = toDateStr(modalDate);
        const infos = getDeliveryInfos(modalDate);
        return (
          <Modal transparent animationType="fade" onRequestClose={() => setModalDate(null)}>
            <TouchableWithoutFeedback onPress={() => setModalDate(null)}>
              <View style={modal.backdrop} />
            </TouchableWithoutFeedback>
            <View style={modal.box}>
              <ThemedText variant="subtitle" color="mint" style={modal.title}>
                {formatDateShort(dateStr)}
              </ThemedText>
              <ThemedText variant="small" color="muted" style={modal.subtitle}>
                {infos.length === 1 ? 'Delivery scheduled' : `${infos.length} deliveries scheduled`}
              </ThemedText>
              {infos.map(({ sub, cancelled, color }) => {
                const planName = sub.subscription_plans?.plan_name ?? `Plan #${sub.plan_id}`;
                return (
                  <View key={sub.id} style={modal.row}>
                    <View style={[modal.colorDot, { backgroundColor: color }]} />
                    <ThemedText variant="body" color="primary" style={modal.planName}>
                      {planName}
                    </ThemedText>
                    <TouchableOpacity
                      onPress={async () => {
                        await handleToggleDay(sub, cancelled, dateStr);
                        setModalDate(null);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <ThemedText
                        variant="body"
                        color={cancelled ? 'mint' : 'muted'}
                      >
                        {cancelled ? 'Resume' : 'Skip'}
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                );
              })}
              <TouchableOpacity onPress={() => setModalDate(null)} style={modal.closeBtn}>
                <ThemedText variant="small" color="muted">Close</ThemedText>
              </TouchableOpacity>
            </View>
          </Modal>
        );
      })()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  headerSpacer: { width: 48 },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: Theme.colors.text.mint },
  tabTextActive: { fontSize: Theme.typography.sizes.body + 2 },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  rowLeft: { flex: 1, marginRight: Theme.spacing.sm },
  rowMeta: { marginTop: 4 },
  calendarWrap: {
    marginTop: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  calendarLabel: {
    letterSpacing: 1,
    paddingHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  calendarRow: {
    gap: 8,
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: 4,
  },
  datePill: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: 10,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
    backgroundColor: Theme.colors.background.secondary,
    minWidth: 48,
  },
  datePillToday: {
    borderColor: Theme.colors.text.subtitle,
  },
  datePillDelivery: {
    borderColor: Theme.colors.text.mint,
  },
  datePillCancelled: {
    borderColor: Theme.colors.status.error,
    opacity: 0.6,
  },
  dotRow: { flexDirection: 'row', gap: 3, height: 8, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dotActive: { backgroundColor: Theme.colors.text.mint },
  dotCancelled: { backgroundColor: Theme.colors.status.error },
  addBtn: {
    position: 'absolute',
    left: Theme.spacing.md,
    right: Theme.spacing.md,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    shadowColor: Theme.colors.text.mint,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  addBtnText: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    fontWeight: '600',
  },
});

const modal = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  box: {
    position: 'absolute',
    alignSelf: 'center',
    top: '35%',
    width: 300,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    padding: Theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  title: { marginBottom: 2 },
  subtitle: { marginBottom: Theme.spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Theme.spacing.sm,
  },
  planName: { flex: 1 },
  closeBtn: {
    marginTop: Theme.spacing.sm,
    alignItems: 'center',
  },
});
