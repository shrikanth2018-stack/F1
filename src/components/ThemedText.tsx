/**
 * 1stOne F1 — ThemedText
 * All text in the app MUST use this component.
 * Never use raw <Text> with inline styles.
 * STRICTLY NO BOLD — fontWeight is never 'bold'.
 */

import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { Theme } from '../theme';

type TextVariant = 'micro' | 'small' | 'body' | 'subtitle' | 'header' | 'title';
type TextColor = 'primary' | 'subtitle' | 'muted' | 'accent';

interface ThemedTextProps extends TextProps {
  variant?: TextVariant;
  color?: TextColor;
}

export function ThemedText({
  variant = 'body',
  color = 'primary',
  style,
  ...props
}: ThemedTextProps) {
  return (
    <Text
      style={[
        {
          fontFamily: Theme.typography.fontFamily,
          fontSize: Theme.typography.sizes[variant],
          color: Theme.colors.text[color],
          letterSpacing: Theme.typography.letterSpacing.normal,
        },
        style,
      ]}
      {...props}
    />
  );
}
