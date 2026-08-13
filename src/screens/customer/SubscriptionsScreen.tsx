/**
 * 1stOne F1 — My Subscriptions Screen
 *
 * Grouped by delivery cycle, the same shape as all three Home tabs.
 * Rows: plan name + pause toggle on right.
 * Shared calendar at bottom — dots for scheduled deliveries,
 * tap a day to skip or resume that day's delivery.
 *
 * THE FOOD | ESSENTIALS TABS ARE GONE. They filtered on
 * `subscription_plans.plan_type`, which stopped describing a plan's contents
 * the day the custom builder shipped: a custom plan must hold at least one
 * meal, so `create_custom_plan` always writes `'food'`, and a plan of idli
 * AND milk filed itself under Food with its milk invisible and no way to
 * reach it from Essentials. The type was never what a customer navigates by
 * anyway — the cycle is. The delivery calendar below had already reached the
 * same conclusion on its own and reads across both types deliberately.
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ListRow, ListRowSeparator } from '../../components/ListRow';
import { ScreenHeader } from '../../components/ScreenHeader';
import { EmptyState } from '../../components/EmptyState';
import { FooterAction, FOOTER_CLEARANCE } from '../../components/FooterAction';
import {
  useMySubscriptions,
  usePauseSubscription,
  useAllCancelledDays,
  useSkipDay,
  useUndoSkip,
} from '../../hooks/useSubscriptions';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { subscriptionDaysRemaining } from '../../utils/subscriptionMath';
import { useBrowsePlans } from '../../hooks/useBrowsePlans';
import { CycleGroup } from './components/CycleGroup';
import { CyclePopup } from './components/CyclePopup';
import { sortByCutoff, buildPlanSections, type SectionMeta } from './components/homeShared';
import { formatDateShort } from '../../utils/formatters';
import { istDateStr, addDaysToISODate } from '../../utils/istDate';
import { trackSkipDay, trackSubscriptionPaused } from '../../utils/analytics';
import type { UserSubscription, CancelledSubscriptionDay } from '../../types';

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
    plan_type: 'food' | 'essentials';
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
  const endDate = addDaysToISODate(sub.start_date, duration - 1 + subCancelled.length);
  // The date must be in range but not itself a cancelled day
  const isSkipped = subCancelled.some((c) => c.cancelled_date === dateStr);
  return dateStr >= sub.start_date && dateStr <= endDate && !isSkipped;
}

export function SubscriptionsScreen() {
  const browsePlans = useBrowsePlans();
  const [modalDate, setModalDate] = useState<Date | null>(null);
  const [popupCycle, setPopupCycle] = useState<SectionMeta | null>(null);

  const { data: rawSubs, isLoading, refetch } = useMySubscriptions();
  const { mutateAsync: togglePause } = usePauseSubscription();
  const { mutateAsync: skipDay } = useSkipDay();
  const { mutateAsync: undoSkip } = useUndoSkip();
  const { data: cycles } = useDeliveryCycles();

  const subs = useMemo(() => (rawSubs ?? []) as EnrichedSub[], [rawSubs]);

  // Grouped by cycle, next open cutoff first — the same ordering and the same
  // CycleGroup the Home tabs use, so the bounce and the headers match.
  // buildPlanSections keeps a sub whose cycle is missing or deactivated in a
  // trailing group rather than dropping it: a plan you are PAYING for must
  // never vanish from this screen.
  const subSections = useMemo(() => {
    const withCycle = subs.map((s) => ({
      ...s,
      cycle_id: s.subscription_plans?.cycle_id ?? null,
    }));
    return buildPlanSections(withCycle, sortByCutoff(cycles ?? []), 'Other');
  }, [subs, cycles]);

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
      const dateStr = istDateStr(date);
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
      trackSkipDay(sub.id);
    }
    refetchCancelled();
  }, [cycles, skipDay, undoSkip, refetchCancelled]);

  const renderSub = (item: EnrichedSub, idx: number) => {
    const plan = item.subscription_plans;
    const isRunning = item.is_active && !item.is_paused;
    const isPendingPayment = !item.is_active && item.payment_method === 'razorpay';

    /**
     * WHAT IS LEFT, not what is spent — and worded exactly as the Plans rail
     * words it. The two describe the same subscription and disagreed: the rail
     * said "28 left out of 30" while this said "Day 2/30". A customer checking
     * one against the other had to do the subtraction to see they matched.
     *
     * NO CYCLE NAME HERE, deliberately. This list is already grouped by cycle
     * (buildPlanSections) so the section heading above the row says it; the
     * rail is a flat list and has to carry it on each line.
     *
     * The start date appears only while the plan has not begun. Once it is
     * running, when it started is history — what remains is the live question,
     * and the calendar below covers the dates.
     *
     * `subscriptionDaysRemaining` rather than a subtraction here: pause and
     * skip push the end date out, so remaining is not `total - elapsed`. The
     * rail already uses it and the two must not drift.
     */
    const total = plan?.duration_days ?? 0;
    const left = subscriptionDaysRemaining({ duration_days: total }, item);
    const notStarted = (item.days_consumed ?? 0) === 0;

    return (
      <React.Fragment key={item.id}>
        {idx > 0 && <ListRowSeparator />}
        <ListRow
        title={plan?.plan_name ?? `Plan #${item.plan_id}`}
        subtitle={
          isPendingPayment
            ? 'Awaiting payment confirmation'
            : [
                item.is_paused ? 'Paused' : null,
                notStarted ? `Starts ${formatDateShort(item.start_date)}` : null,
                `${left} left out of ${total}`,
              ].filter(Boolean).join(' · ')
        }
        trailing={item.is_active ? (
          <Switch
            value={isRunning}
            onValueChange={() => {
              const pausing = isRunning;
              togglePause({ id: item.id, pause: pausing })
                .then(() => { if (pausing) trackSubscriptionPaused(item.id); })
                .catch(() => {});
            }}
            trackColor={{
              false: Theme.colors.background.input,
              true: Theme.colors.text.mint,
            }}
            thumbColor={Theme.colors.text.primary}
          />
        ) : undefined}
        />
      </React.Fragment>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <ScreenHeader title="My Subscriptions" />

      {/* Subscription list — calendar appended as footer, scrolls together */}
      <FlatList
        data={subSections}
        keyExtractor={(section) => String(section.cycleId)}
        renderItem={({ item: section, index }) => (
          <CycleGroup section={section} index={index} onOpenPopup={setPopupCycle}>
            {section.data.map(renderSub)}
          </CycleGroup>
        )}
        style={styles.list}
        // Air between the screen title and the first cycle heading. Without
        // it the two sit a few points apart and read as one stacked title
        // rather than a page heading followed by its first group.
        contentContainerStyle={{
          paddingTop: Theme.spacing.lg,
          paddingBottom: FOOTER_CLEARANCE,
        }}
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
              title="No subscriptions yet"
              subtitle="Subscribe to a plan to lock in your daily meals"
              actionLabel="Browse Plans"
              onAction={browsePlans}
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
                const isToday = istDateStr(date) === istDateStr(new Date());

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
      <FooterAction
        label="+  Add a plan  ›"
        onPress={browsePlans}
        accessibilityLabel="Browse and add a subscription plan"
      />

      {/* Cycle detail — the same sheet the Home tabs open from a group
          header, so "Dispatch by 7:30 AM ›" means the same thing here. */}
      {popupCycle && <CyclePopup cycle={popupCycle} onClose={() => setPopupCycle(null)} />}

      {/* Day detail modal */}
      {modalDate && (() => {
        const dateStr = istDateStr(modalDate);
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
                        color={cancelled ? 'mint' : 'primary'}
                        style={!cancelled && { color: Theme.colors.status.warning }}
                      >
                        {cancelled ? 'Resume' : 'Skip'}
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </Modal>
        );
      })()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  list: { flex: 1, paddingHorizontal: Theme.spacing.xs },



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

  dotRow: { flexDirection: 'row', gap: 3, height: 8, justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },


});

const modal = StyleSheet.create({
  title: { marginBottom: 2 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Theme.colors.layout.overlayMid,
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
    shadowColor: Theme.colors.layout.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
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

});
