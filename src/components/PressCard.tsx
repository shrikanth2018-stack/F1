/**
 * 1stOne F1 — PressCard
 *
 * A card the customer can choose: a delivery time, a plan length, an address,
 * a payment method.
 *
 * ═══ SELECTION IS A RISE TOWARD LIGHT ═══
 *
 * The surface goes one tier lighter (`background.secondary → tertiary`) and
 * the edge takes the mint, both interpolated rather than switched. That is not
 * a stylistic preference — at `#151515` it is the only honest way to draw
 * elevation. A drop shadow has nothing to darken at this background, and a
 * light outer glow renders on iOS while Android's elevation draws dark shadows
 * only. A shade of grey is the one treatment that reads identically on both.
 * The 1.01 scale is a hint on top, not the effect. See `colors.layout.
 * photoEdge`, which records the same finding for photo tiles.
 *
 * WHAT IT REPLACES. Selectable cards across the customer screens were a
 * `borderColor: 'transparent'` swapped for an accent on select — an instant
 * hard switch, with no press feedback at all, written out separately on
 * Checkout, PlanDetail and the plan builder.
 *
 * A DISABLED CARD DOES NOT FLINCH. `disabled` blocks the touchable outright:
 * an unavailable option that moved under a finger would be promising something
 * it will not do. It stays legible rather than hidden, so the reason printed
 * on it can still be read.
 *
 * MOTION IS `withTiming`, NEVER A SPRING. This is a control answering the
 * customer, and the app's rule is that controls respond without overshoot —
 * see the note on `Theme.motion`.
 */

import React, { useEffect } from 'react';
import { TouchableOpacity, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Theme } from '../theme';

const EASE = Easing.out(Easing.cubic);
const MOTION = { duration: Theme.motion.durationMs, easing: EASE } as const;
const PRESS = { duration: Theme.motion.pressMs, easing: EASE } as const;

interface PressCardProps {
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** 'radio' where the card is one of a set; 'button' where it just opens. */
  accessibilityRole?: 'button' | 'radio';
  accessibilityLabel: string;
  /** Extra layout on the touch target — padding and direction live inside. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function PressCard({
  selected = false,
  disabled = false,
  onPress,
  accessibilityRole = 'button',
  accessibilityLabel,
  style,
  children,
}: PressCardProps) {
  const on = useSharedValue(selected ? 1 : 0);
  const press = useSharedValue(1);

  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, MOTION);
  }, [selected, on]);

  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      on.value, [0, 1],
      [Theme.colors.background.secondary, Theme.colors.background.tertiary],
    ),
    borderColor: interpolateColor(
      on.value, [0, 1],
      [Theme.colors.layout.divider, Theme.colors.text.mint],
    ),
    transform: [{ scale: press.value * (1 + on.value * (Theme.motion.select - 1)) }],
  }));

  return (
    <Animated.View style={[styles.shell, disabled ? styles.off : null, animated]}>
      <TouchableOpacity
        style={[styles.tap, style]}
        // The scale IS the feedback; an opacity flash on top would be two
        // answers to one touch.
        activeOpacity={1}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => { press.value = withTiming(Theme.motion.press, PRESS); }}
        onPressOut={() => { press.value = withTiming(1, PRESS); }}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled, selected }}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /**
   * The animated shell. Surface and edge colours are set by the worklet above
   * and deliberately absent here — a value in both places would be the static
   * one winning on first paint and flickering to the animated one.
   */
  shell: {
    marginBottom: Theme.spacing.sm,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    overflow: 'hidden',
  },
  /** The touch target. All padding lives here, so the whole card is tappable. */
  tap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: Theme.components.touchMin,
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
  },
  /** Unavailable, and readable about it — not hidden, so the reason can be read. */
  off: { opacity: 0.45 },
});
