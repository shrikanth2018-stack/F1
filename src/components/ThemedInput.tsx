/**
 * 1stOne F1 — ThemedInput
 * Flat dark input field using Theme values.
 * Two modes: 'filled' (default) or 'underline'
 */

import React from 'react';
import {
  TextInput,
  TextInputProps,
  View,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface ThemedInputProps extends TextInputProps {
  label?: string;
  mode?: 'filled' | 'underline';
  /**
   * Layout for the WRAPPER, not the field.
   *
   * `style` reaches the TextInput inside, which is right for colour and size
   * and useless for anything positional: the wrapper carries a bottom margin
   * for stacking in a form, and a parent laying this out in a ROW had no way
   * to reach it. Putting `flex: 1` on the field did nothing, because the box
   * around it was still sizing to its content — which is how Edit Profile's
   * "Name" came to sit off-centre beside its label.
   */
  containerStyle?: StyleProp<ViewStyle>;
}

export function ThemedInput({
  label,
  mode = 'filled',
  style,
  containerStyle,
  ...props
}: ThemedInputProps) {
  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <ThemedText variant="small" color="subtitle" style={styles.label}>
          {label}
        </ThemedText>
      )}
      <TextInput
        style={[
          styles.base,
          mode === 'filled' ? styles.filled : styles.underline,
          style,
        ]}
        placeholderTextColor={Theme.colors.text.muted}
        selectionColor={Theme.colors.action.primary}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Theme.spacing.md,
  },
  label: {
    marginBottom: Theme.spacing.xs,
  },
  base: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    color: Theme.colors.text.primary,
    paddingVertical: 12,
    paddingHorizontal: Theme.spacing.md,
  },
  filled: {
    backgroundColor: Theme.colors.background.input,
    borderRadius: Theme.components.inputRadius,
  },
  underline: {
    borderBottomWidth: Theme.components.inputBorderBottomWidth,
    borderBottomColor: Theme.colors.background.input,
  },
});
