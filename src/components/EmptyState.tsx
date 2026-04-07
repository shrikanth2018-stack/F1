/**
 * 1stOne F1 — EmptyState
 * Centered message for empty lists (no orders, no items, etc.)
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';
import { ThemedButton } from './ThemedButton';

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, subtitle, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <ThemedText variant="subtitle" color="subtitle" style={styles.title}>
        {title}
      </ThemedText>
      {subtitle && (
        <ThemedText variant="small" color="muted" style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      )}
      {actionLabel && onAction && (
        <ThemedButton
          title={actionLabel}
          variant="text"
          onPress={onAction}
          style={styles.action}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.xl,
  },
  title: {
    textAlign: 'center',
    marginBottom: Theme.spacing.xs,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: Theme.spacing.md,
  },
  action: {
    marginTop: Theme.spacing.sm,
  },
});
