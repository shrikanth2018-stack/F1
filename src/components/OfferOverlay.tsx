/**
 * 1stOne F1 — Offer text over the hero
 *
 * Used by the customer Home hero AND by the admin composer's preview, so what
 * an admin approves is drawn by the same code a customer sees. The preview
 * used to be a separate lookalike, which is how a preview quietly starts
 * lying.
 *
 * Position, size and treatment all come from the banner's own JSON via
 * `resolveLayout`, so a banner saved before those fields existed keeps the old
 * look rather than jumping to a new one.
 *
 * `absolute` is off in the composer, where the overlay sits inside a fixed
 * preview frame rather than being positioned within a hero.
 */

import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { Theme } from '../theme';
import {
  resolveLayout,
  positionStyle,
  panelBackground,
  textAlign,
  TITLE_SIZE,
  SUBTITLE_SIZE,
  TEXT_SHADOW,
} from '../utils/bannerStyle';
import type { CustomBannerContent } from '../hooks/useBanner';

interface Props {
  content: CustomBannerContent;
  /** Position within the hero. Off in the composer preview. */
  absolute?: boolean;
  /** Pulse animation style, when the admin enabled it. */
  animatedStyle?: StyleProp<ViewStyle>;
}

export function OfferOverlay({ content, absolute = true, animatedStyle }: Props) {
  const layout = resolveLayout(content);
  const isPanel = layout.style === 'panel';
  const align = textAlign(layout);

  const blockStyle = [
    styles.block,
    absolute ? { position: 'absolute' as const, ...positionStyle(layout, Theme.spacing.md) } : null,
    isPanel
      ? {
          backgroundColor: panelBackground(content.bg_color),
          borderRadius: 10,
          paddingHorizontal: Theme.spacing.md,
          paddingVertical: Theme.spacing.sm,
        }
      : null,
    { alignItems: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' } as ViewStyle,
    animatedStyle,
  ];

  // The shadow does the readability work in BOTH treatments — a tinted panel
  // at 75% still lets a bright photograph through.
  const textBase = { color: content.text_color, textAlign: align, ...TEXT_SHADOW };

  return (
    <Animated.View style={blockStyle}>
      {/* Scrim keeps the admin's colour as an accent rather than a card, so
          the choice still means something once the panel is gone. */}
      {!isPanel ? (
        <View style={[styles.accent, { backgroundColor: content.bg_color }]} />
      ) : null}

      {!!content.emoji && <Text style={styles.emoji}>{content.emoji}</Text>}

      <Text
        style={[styles.title, textBase, { fontSize: TITLE_SIZE[layout.size] }]}
        numberOfLines={2}
      >
        {content.title}
      </Text>

      {!!content.subtitle && (
        <Text
          style={[styles.sub, textBase, { fontSize: SUBTITLE_SIZE[layout.size] }]}
          numberOfLines={1}
        >
          {content.subtitle}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: { maxWidth: '100%' },
  accent: { width: 34, height: 3, borderRadius: 2, marginBottom: 6 },
  emoji: { fontSize: Theme.typography.sizes.body + 6, marginBottom: 2 },
  title: { fontFamily: Theme.typography.fontFamily, fontWeight: '500' },
  sub: { fontFamily: Theme.typography.fontFamily, marginTop: 2, opacity: 0.9 },
});
