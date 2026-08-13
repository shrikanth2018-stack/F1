/**
 * 1stOne F1 — FooterAction
 *
 * The one primary action at the foot of a page: Pay, Checkout, Subscribe.
 *
 * WHY IT EXISTS. Five screens had built this independently — Cart, Checkout,
 * PlanDetail, Subscriptions and the plan builder — and they had drifted the
 * way five copies always do: two heights (40 and 44), two label colours, three
 * different bottom offsets, and `Text` in some and `ThemedText` in others. It
 * is the same fault `ScreenHeader` was written to end, one edge of the screen
 * further down.
 *
 * WHY THE GRADIENT. Every copy was absolutely positioned over plain content,
 * so a row scrolling past was cut off mid-line at the screen edge — the one
 * detail that made these pages look unfinished rather than deep. Content now
 * fades out UNDERNEATH the button. `pointerEvents="box-none"` so only the
 * button takes touches; the faded area still belongs to the list behind it.
 *
 * THE LABEL CARRIES THE REFUSAL. `onPress` omitted means blocked, and the
 * label is expected to say why — "Add at least one meal", not a greyed "Next".
 * A disabled button that gives no reason is the thing customers tap twice and
 * then abandon. That is a contract with the caller, not something this
 * component can enforce, so it is stated here and honoured at the call sites.
 *
 * NO HAPTIC HERE. A tick belongs to the moment a choice registers, not to
 * arriving at a payment sheet — and firing one for every footer in the app
 * would make the two that matter mean nothing. Callers that want one call it
 * in their own `onPress`.
 */

import React from 'react';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface FooterActionProps {
  /** What the button says. When `onPress` is absent this must name the blocker. */
  label: string;
  /** Omit to block the action — see the note above about saying why. */
  onPress?: () => void;
  /** Shows a spinner and refuses touches. */
  busy?: boolean;
  /** Announced to a screen reader in place of the label, where the label is terse. */
  accessibilityLabel?: string;
  /**
   * A second, quieter action above the button — "Skip for now", a note, a
   * secondary link. Rendered inside the scrim so it fades with it.
   */
  children?: React.ReactNode;
}

/**
 * The gradient's stops. Hoisted out of render because a fresh array each pass
 * makes LinearGradient re-evaluate its shader — the same reason CartScreen
 * hoists its own.
 */
const SCRIM_COLORS: readonly [string, string, string] = [
  'transparent',
  `${Theme.colors.background.primary}E6`,
  Theme.colors.background.primary,
];
const SCRIM_STOPS: readonly [number, number, number] = [0, 0.45, 1];

export function FooterAction({
  label, onPress, busy = false, accessibilityLabel, children,
}: FooterActionProps) {
  const insets = useSafeAreaInsets();
  const blocked = !onPress || busy;

  return (
    <LinearGradient
      colors={SCRIM_COLORS}
      locations={SCRIM_STOPS}
      style={[styles.scrim, { paddingBottom: insets.bottom + Theme.spacing.md }]}
      pointerEvents="box-none"
    >
      {children != null && <View style={styles.slot}>{children}</View>}
      <TouchableOpacity
        style={styles.button}
        activeOpacity={0.85}
        disabled={blocked}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: blocked, busy }}
      >
        {busy
          ? <ActivityIndicator color={Theme.colors.text.mint} />
          : (
            <ThemedText variant="body" color={onPress ? 'mint' : 'muted'} numberOfLines={1}>
              {label}
            </ThemedText>
          )}
      </TouchableOpacity>
    </LinearGradient>
  );
}

/**
 * How much room a screen must leave at the foot of its scroll content so the
 * last row is never trapped under the button.
 *
 * Exported as a number rather than left to each screen's judgement: the five
 * copies this replaces used 100, 110 and 120, and the one that used 100 hid
 * part of its final row.
 */
export const FOOTER_CLEARANCE = 120;

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.md,
    justifyContent: 'flex-end',
  },
  slot: { marginBottom: Theme.spacing.sm },
  button: {
    height: 44,
    borderRadius: 22,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.md,
  },
});
