/**
 * 1stOne F1 — Midnight Glass Design System
 *
 * Foundational components for the Apple Dark Mode + Glassmorphism UI.
 *
 * GlassCard uses a semi-transparent View fallback today.
 * To upgrade to native blur, install expo-blur and swap the inner View
 * for <BlurView intensity={20} tint="dark"> — the layout is identical.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens (self-contained — do not reference Theme to stay independent)
// ─────────────────────────────────────────────────────────────────────────────

const MG = {
  black:        '#000000',
  glass:        'rgba(255, 255, 255, 0.06)',
  glassBorder:  'rgba(255, 255, 255, 0.10)',
  white:        '#FFFFFF',
  bodyGrey:     'rgba(255, 255, 255, 0.85)',
  captionGrey:  '#8E8E93',
  radius:       16,
} as const;

const SPRING = { damping: 18, stiffness: 420, mass: 0.8 } as const;

// ─────────────────────────────────────────────────────────────────────────────
// ScreenBackground
// ─────────────────────────────────────────────────────────────────────────────

interface ScreenBackgroundProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function ScreenBackground({ children, style }: ScreenBackgroundProps) {
  return (
    <SafeAreaView style={[styles.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GlassCard
//
// Swap for BlurView once expo-blur is installed:
//   import { BlurView } from 'expo-blur';
//   Replace the inner <View style={styles.glass}> with:
//   <BlurView intensity={20} tint="dark" style={[styles.glassCard, style]}>
// ─────────────────────────────────────────────────────────────────────────────

interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function GlassCard({ children, style }: GlassCardProps) {
  return (
    <View style={[styles.glassCard, style]}>
      <View style={styles.glassFill}>
        {children}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HapticButton
// ─────────────────────────────────────────────────────────────────────────────

interface HapticButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  hapticStyle?: Haptics.ImpactFeedbackStyle;
}

export function HapticButton({
  onPress,
  children,
  style,
  disabled = false,
  hapticStyle = Haptics.ImpactFeedbackStyle.Light,
}: HapticButtonProps) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.95, SPRING);
    Haptics.impactAsync(hapticStyle);
  }, [hapticStyle, scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, SPRING);
  }, [scale]);

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={disabled ? undefined : handlePressIn}
      onPressOut={disabled ? undefined : handlePressOut}
      disabled={disabled}
    >
      <Animated.View style={[animStyle, style, disabled && styles.disabled]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Typography
// ─────────────────────────────────────────────────────────────────────────────

interface TypographyProps {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

export function Heading({ children, style, numberOfLines }: TypographyProps) {
  return (
    <Text style={[styles.heading, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Body({ children, style, numberOfLines }: TypographyProps) {
  return (
    <Text style={[styles.body, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Caption({ children, style, numberOfLines }: TypographyProps) {
  return (
    <Text style={[styles.caption, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ScreenBackground
  screen: {
    flex: 1,
    backgroundColor: MG.black,
  },

  // GlassCard — outer clip boundary, inner glass fill
  glassCard: {
    borderRadius: MG.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MG.glassBorder,
    overflow: 'hidden',
  },
  glassFill: {
    backgroundColor: MG.glass,
  },

  // HapticButton
  disabled: {
    opacity: 0.4,
  },

  // Typography
  heading: {
    color: MG.white,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  body: {
    color: MG.bodyGrey,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
  },
  caption: {
    color: MG.captionGrey,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
});
