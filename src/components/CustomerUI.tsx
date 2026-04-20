/**
 * 1stOne F1 — Midnight Glass Design System
 *
 * Foundational components for the Apple Dark Mode + Glassmorphism UI.
 * Powered by expo-blur (native BlurView on iOS, semi-transparent fallback on Android).
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Vibration,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────

export const MG = {
  black:        '#000000',
  glassBorder:  'rgba(255, 255, 255, 0.10)',
  white:        '#FFFFFF',
  bodyGrey:     'rgba(255, 255, 255, 0.85)',
  captionGrey:  '#8E8E93',
  neonGreen:    '#4ECDC4',
  errorRed:     '#ef4444',
  warningAmber: '#FFBF00',
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
// BlurView fills the card background natively on iOS.
// intensity controls blur strength (20 = subtle, 40 = heavy/opaque feel).
// ─────────────────────────────────────────────────────────────────────────────

interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
}

export function GlassCard({ children, style, intensity = 20 }: GlassCardProps) {
  return (
    <View style={[styles.glassCard, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.glassContent}>
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
  hapticStyle?: 'light' | 'medium' | 'heavy';
}

export function HapticButton({
  onPress,
  children,
  style,
  disabled = false,
  hapticStyle = 'light',
}: HapticButtonProps) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.95, SPRING);
    Vibration.vibrate(hapticStyle === 'heavy' ? 20 : hapticStyle === 'medium' ? 10 : 5);
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
  screen: {
    flex: 1,
    backgroundColor: MG.black,
  },
  glassCard: {
    borderRadius: MG.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MG.glassBorder,
    overflow: 'hidden',
  },
  glassContent: {
    // sits on top of the absolute BlurView layer
  },
  disabled: {
    opacity: 0.4,
  },
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
