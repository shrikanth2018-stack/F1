/**
 * 1stOne F1 — ThemedText
 * All text in the app MUST use this component.
 * Never use raw <Text> with inline styles.
 * STRICTLY NO BOLD — fontWeight is never 'bold'.
 */

import React from 'react';
import { Text, TextProps } from 'react-native';
import { Theme } from '../theme';

type TextVariant = 'micro' | 'small' | 'body' | 'subtitle' | 'header' | 'title';
type TextColor = 'primary' | 'subtitle' | 'muted' | 'accent' | 'mint';

interface ThemedTextProps extends TextProps {
  variant?: TextVariant;
  color?: TextColor;
  /**
   * Emphasis WITHOUT weight — bumps the size by Theme.typography.emphasisStep.
   * This is how the app stands text out: size + colour, never bold.
   */
  emphasis?: boolean;
}

export function ThemedText({
  variant = 'body',
  color = 'primary',
  emphasis = false,
  style,
  ...props
}: ThemedTextProps) {
  return (
    <Text
      allowFontScaling={false}
      style={[
        {
          fontFamily: Theme.typography.fontFamily,
          fontSize:
            Theme.typography.sizes[variant] +
            (emphasis ? Theme.typography.emphasisStep : 0),
          color: Theme.colors.text[color],
          letterSpacing: Theme.typography.letterSpacing.normal,
        },
        style,
      ]}
      {...props}
    />
  );
}
