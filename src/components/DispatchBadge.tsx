/**
 * 1stOne F1 — DispatchBadge
 * Small colored badge showing dispatch scenario (A/B) or status.
 * Used on order cards, cart items, and staff order lists.
 *
 * Scenario A = "Today" (green)
 * Scenario B = "Tomorrow" (amber/warning)
 * Custom statuses use appropriate colors.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

type BadgeVariant = 'today' | 'tomorrow' | 'success' | 'warning' | 'error' | 'info';

interface DispatchBadgeProps {
  label: string;
  variant?: BadgeVariant;
}

const badgeColors: Record<BadgeVariant, string> = {
  today: Theme.colors.status.success,
  tomorrow: Theme.colors.status.warning,
  success: Theme.colors.status.success,
  warning: Theme.colors.status.warning,
  error: Theme.colors.status.error,
  info: Theme.colors.action.primary,
};

export function DispatchBadge({ label, variant = 'info' }: DispatchBadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: badgeColors[variant] }]}>
      <ThemedText variant="micro" color="primary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
});
