/**
 * 1stOne F1 — ThemedButton
 * Primary action button using Theme.colors.action.primary (Sky Blue)
 * Text variant for secondary actions
 */

import React from 'react';
import { TouchableOpacity, TouchableOpacityProps, StyleSheet, ActivityIndicator } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface ThemedButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: 'primary' | 'text' | 'danger';
  loading?: boolean;
  size?: 'normal' | 'small';
}

export function ThemedButton({
  title,
  variant = 'primary',
  loading = false,
  size = 'normal',
  style,
  disabled,
  ...props
}: ThemedButtonProps) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';

  return (
    <TouchableOpacity
      style={[
        styles.base,
        isPrimary && styles.primary,
        isDanger && styles.danger,
        size === 'small' && styles.small,
        (disabled || loading) && styles.disabled,
        style,
      ]}
      disabled={disabled || loading}
      activeOpacity={0.7}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={Theme.colors.text.primary} size="small" />
      ) : (
        <ThemedText
          variant={size === 'small' ? 'small' : 'body'}
          color={variant === 'text' ? 'accent' : 'primary'}
          style={{ letterSpacing: Theme.typography.letterSpacing.wide }}
        >
          {title}
        </ThemedText>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: Theme.spacing.lg,
    borderRadius: Theme.components.inputRadius,
  },
  primary: {
    backgroundColor: Theme.colors.action.primary,
  },
  danger: {
    backgroundColor: Theme.colors.status.error,
  },
  small: {
    paddingVertical: 8,
    paddingHorizontal: Theme.spacing.md,
  },
  disabled: {
    opacity: 0.5,
  },
});
