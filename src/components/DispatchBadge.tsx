/**
 * 1stOne F1 — DispatchBadge
 * Plain text label — no background box.
 * today = green, tomorrow = amber.
 */

import React from 'react';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

type BadgeVariant = 'today' | 'tomorrow' | 'success' | 'warning' | 'error' | 'info';

interface DispatchBadgeProps {
  label: string;
  variant?: BadgeVariant;
}

const textColors: Record<BadgeVariant, string> = {
  today:    Theme.colors.status.success,
  tomorrow: Theme.colors.status.warning,
  success:  Theme.colors.status.success,
  warning:  Theme.colors.status.warning,
  error:    Theme.colors.status.error,
  info:     Theme.colors.action.primary,
};

export function DispatchBadge({ label, variant = 'info' }: DispatchBadgeProps) {
  return (
    <ThemedText variant="micro" style={{ color: textColors[variant] }}>
      {label}
    </ThemedText>
  );
}
