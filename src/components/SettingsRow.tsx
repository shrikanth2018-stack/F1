/**
 * 1stOne F1 — SettingsRow
 * Tappable row for profile/settings screens.
 * Optional right chevron, subtitle, and toggle support.
 */

import React from 'react';
import { TouchableOpacity, View, Switch, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface SettingsRowProps {
  label: string;
  subtitle?: string;
  onPress?: () => void;
  showChevron?: boolean;
  toggleValue?: boolean;
  onToggle?: (value: boolean) => void;
}

export function SettingsRow({
  label,
  subtitle,
  onPress,
  showChevron = false,
  toggleValue,
  onToggle,
}: SettingsRowProps) {
  const content = (
    <View style={styles.row}>
      <View style={styles.left}>
        <ThemedText variant="body" color="primary">
          {label}
        </ThemedText>
        {subtitle && (
          <ThemedText variant="small" color="muted" style={styles.subtitle}>
            {subtitle}
          </ThemedText>
        )}
      </View>
      {onToggle !== undefined && toggleValue !== undefined ? (
        <Switch
          value={toggleValue}
          onValueChange={onToggle}
          trackColor={{
            false: Theme.colors.background.input,
            true: Theme.colors.action.primary,
          }}
          thumbColor={Theme.colors.text.primary}
        />
      ) : showChevron ? (
        <ThemedText variant="body" color="muted">
          ›
        </ThemedText>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: Theme.spacing.md,
  },
  left: {
    flex: 1,
    marginRight: Theme.spacing.md,
  },
  subtitle: {
    marginTop: 2,
  },
});
