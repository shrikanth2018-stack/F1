/**
 * 1stOne F1 — Subscription Detail Screen
 *
 * Shows active subscription with:
 * - Status, plan info, days consumed
 * - Calendar for skip/unskip days
 * - Pause/Resume toggle
 */

import React, { useCallback } from 'react';
import {
  View,
  ScrollView,
  Alert,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { DispatchBadge } from '../../components/DispatchBadge';
import { Divider } from '../../components/Divider';
import { SubscriptionCalendar } from '../../components/SubscriptionCalendar';
import {
  useMySubscriptions,
  useCancelledDays,
  useSkipDay,
  useUndoSkip,
  usePauseSubscription,
} from '../../hooks/useSubscriptions';
import { formatPriceShort, formatDateLong } from '../../utils/formatters';

export function SubscriptionDetailScreen({ route, navigation }: any) {
  const { subscriptionId } = route.params;

  const { data: subs } = useMySubscriptions();
  const sub = subs?.find((s) => s.id === subscriptionId) as any;
  const plan = sub?.subscription_plans;

  const { data: cancelledDays, refetch: refetchCancelled } = useCancelledDays(subscriptionId);
  const { mutateAsync: skipDay } = useSkipDay();
  const { mutateAsync: undoSkip } = useUndoSkip();
  const { mutateAsync: togglePause } = usePauseSubscription();

  const cancelledDates = (cancelledDays ?? []).map((d) => d.cancelled_date);

  const handleToggleDate = useCallback(
    async (dateStr: string) => {
      const existing = (cancelledDays ?? []).find(
        (d) => d.cancelled_date === dateStr
      );

      try {
        if (existing) {
          // Undo skip
          await undoSkip({ id: existing.id });
        } else {
          // Skip day
          await skipDay({
            subscription_id: subscriptionId,
            cancelled_date: dateStr,
            cycle_id: plan?.cycle_id ?? 0,
          });
        }
        refetchCancelled();
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to update');
      }
    },
    [cancelledDays, subscriptionId, plan, skipDay, undoSkip, refetchCancelled]
  );

  const handlePauseToggle = useCallback(async () => {
    if (!sub) return;

    const action = sub.is_paused ? 'resume' : 'pause';
    Alert.alert(
      `${sub.is_paused ? 'Resume' : 'Pause'} Subscription?`,
      sub.is_paused
        ? 'Daily orders will resume from tomorrow.'
        : 'No orders will be created while paused.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              await togglePause({ id: sub.id, pause: !sub.is_paused });
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  }, [sub, togglePause]);

  if (!sub || !plan) {
    return (
      <SafeAreaView style={styles.container}>
        <ThemedText variant="body" color="subtitle" style={styles.loading}>
          Loading...
        </ThemedText>
      </SafeAreaView>
    );
  }

  const startDate = sub.start_date;
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + plan.duration_days - 1);
  const daysRemaining = plan.duration_days - sub.days_consumed;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">Subscription</ThemedText>
          <View style={{ width: 40 }} />
        </View>

        {/* Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusTop}>
            <ThemedText variant="subtitle" color="primary">
              {plan.plan_name}
            </ThemedText>
            <DispatchBadge
              label={sub.is_paused ? 'Paused' : sub.is_active ? 'Active' : 'Ended'}
              variant={sub.is_paused ? 'warning' : sub.is_active ? 'success' : 'info'}
            />
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <ThemedText variant="header" color="accent">
                {sub.days_consumed}
              </ThemedText>
              <ThemedText variant="micro" color="muted">consumed</ThemedText>
            </View>
            <View style={styles.stat}>
              <ThemedText variant="header" color="primary">
                {daysRemaining}
              </ThemedText>
              <ThemedText variant="micro" color="muted">remaining</ThemedText>
            </View>
            <View style={styles.stat}>
              <ThemedText variant="header" color="primary">
                {cancelledDates.length}
              </ThemedText>
              <ThemedText variant="micro" color="muted">skipped</ThemedText>
            </View>
          </View>

          <ThemedText variant="small" color="subtitle" style={styles.dateRange}>
            {formatDateLong(startDate)} — {formatDateLong(endDate.toISOString())}
          </ThemedText>
        </View>

        <Divider />

        {/* Calendar */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            DELIVERY CALENDAR
          </ThemedText>
          <ThemedText variant="micro" color="subtitle" style={styles.calendarHint}>
            Tap a future date to skip or unskip
          </ThemedText>
          <SubscriptionCalendar
            startDate={startDate}
            durationDays={plan.duration_days}
            cancelledDates={cancelledDates}
            onToggleDate={handleToggleDate}
          />
        </View>

        <Divider />

        {/* Actions */}
        <View style={styles.section}>
          {sub.is_active && (
            <ThemedButton
              title={sub.is_paused ? 'Resume Subscription' : 'Pause Subscription'}
              variant={sub.is_paused ? 'primary' : 'text'}
              onPress={handlePauseToggle}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  content: {
    paddingBottom: Theme.spacing.xl,
  },
  loading: {
    textAlign: 'center',
    marginTop: Theme.spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  statusCard: {
    backgroundColor: Theme.colors.background.card,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    margin: Theme.spacing.md,
  },
  statusTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: Theme.spacing.sm,
  },
  stat: {
    alignItems: 'center',
  },
  dateRange: {
    textAlign: 'center',
    marginTop: Theme.spacing.xs,
  },
  section: {
    padding: Theme.spacing.md,
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: 4,
  },
  calendarHint: {
    marginBottom: Theme.spacing.sm,
  },
});
