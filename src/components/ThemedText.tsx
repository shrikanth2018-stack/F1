/**
 * 1stOne F1 — ThemedText
 * All text in the app MUST use this component.
 * Never use raw <Text> with inline styles.
 * STRICTLY NO BOLD — fontWeight is never 'bold'.
 */

import React from 'react';
import { Text, TextProps, StyleSheet, type TextStyle } from 'react-native';
import { Theme } from '../theme';

type TextVariant = 'micro' | 'small' | 'body' | 'subtitle' | 'header' | 'title';

/**
 * Leading, per variant.
 *
 * React Native sets NO lineHeight by default — it falls back to the font's own
 * metrics, which vary with size in a way nobody chose. That is why vertical
 * rhythm differed from screen to screen no matter how carefully padding was
 * matched: two stacked `small` lines and two stacked `body` lines were spaced
 * by Tahoma, not by us.
 *
 * Running copy gets the looser ratio because it WRAPS and a second line needs
 * air. Headings get the tighter one: they are usually a single line, and 1.4
 * on a 22pt heading reads as a gap rather than a line.
 */
const VARIANT_LEADING: Record<TextVariant, number> = {
  micro: Theme.typography.lineHeight.normal,
  small: Theme.typography.lineHeight.normal,
  body: Theme.typography.lineHeight.normal,
  subtitle: Theme.typography.lineHeight.tight,
  header: Theme.typography.lineHeight.tight,
  title: Theme.typography.lineHeight.tight,
};
type TextColor = 'primary' | 'subtitle' | 'muted' | 'accent' | 'mint' | 'warning';

/**
 * Every colour a caller may name. `warning` is the only one not under
 * `colors.text` — it reuses the existing status amber rather than adding a
 * second hex for the same colour, so retheming still happens in one place.
 */
const TEXT_COLORS: Record<TextColor, string> = {
  primary: Theme.colors.text.primary,
  subtitle: Theme.colors.text.subtitle,
  muted: Theme.colors.text.muted,
  accent: Theme.colors.text.accent,
  mint: Theme.colors.text.mint,
  warning: Theme.colors.status.warning,
};

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
  const variantSize =
    Theme.typography.sizes[variant] + (emphasis ? Theme.typography.emphasisStep : 0);

  /**
   * THE LINE HEIGHT IS COMPUTED FROM THE SIZE THAT ACTUALLY RENDERS, not from
   * the variant — and that distinction is load-bearing.
   *
   * Callers routinely pass a `style` that overrides `fontSize`: the wallet
   * balance is `variant="title"` (26) wearing `fontSize: sizes.display` (40).
   * Deriving leading from the variant would have put a 40pt glyph in a 33pt
   * line and clipped it. Flattening the incoming style first means the two can
   * never disagree.
   *
   * An explicit `lineHeight` from the caller always wins. A few controls set
   * one to centre a glyph inside a fixed circle, and that is a deliberate
   * decision about a specific control, not a typographic default.
   */
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const renderedSize = typeof flat?.fontSize === 'number' ? flat.fontSize : variantSize;
  const lineHeight =
    typeof flat?.lineHeight === 'number'
      ? flat.lineHeight
      : Math.round(renderedSize * VARIANT_LEADING[variant]);

  return (
    <Text
      allowFontScaling={false}
      style={[
        {
          fontFamily: Theme.typography.fontFamily,
          fontSize: variantSize,
          color: TEXT_COLORS[color],
          letterSpacing: Theme.typography.letterSpacing.normal,
          lineHeight,
        },
        style,
      ]}
      {...props}
    />
  );
}
