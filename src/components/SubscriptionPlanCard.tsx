/**
 * 1stOne F1 — SubscriptionPlanCard
 *
 * Displays a subscription plan with name, duration, price, savings.
 * Tap to view detail / subscribe.
 */

import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';
import { DispatchBadge } from './DispatchBadge';
import { formatPriceShort } from '../utils/formatters';
import type { SubscriptionPlan } from '../types';

interface SubscriptionPlanCardProps {
  plan: SubscriptionPlan & { cycle_name?: string };
  onPress: () => void;
}

export function SubscriptionPlanCard({ plan, onPress }: SubscriptionPlanCardProps) {
  const pricePerDay = plan.price / plan.duration_days;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <View style={styles.topRow}>
        <ThemedText variant="subtitle" color="primary">
          {plan.plan_name}
        </ThemedText>
        {plan.savings_amount > 0 && (
          <DispatchBadge
            label={`Save ${formatPriceShort(plan.savings_amount)}`}
            variant="success"
          />
        )}
      </View>

      <View style={styles.detailRow}>
        <ThemedText variant="small" color="subtitle">
          {plan.duration_days} days
        </ThemedText>
        {plan.cycle_name && (
          <ThemedText variant="small" color="muted">
            · {plan.cycle_name}
          </ThemedText>
        )}
      </View>

      <View style={styles.priceRow}>
        <ThemedText variant="header" color="accent">
          {formatPriceShort(plan.price)}
        </ThemedText>
        <ThemedText variant="micro" color="muted">
          {formatPriceShort(pricePerDay)}/day
        </ThemedText>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: Theme.spacing.sm,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
});
