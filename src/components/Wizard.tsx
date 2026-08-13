/**
 * 1stOne F1 — Wizard shell
 *
 * The parts every step-by-step form in this app needs, in one place: where you
 * are, how you move, and what the hardware back button does about it.
 *
 * EXTRACTED FROM THE PLAN BUILDER RATHER THAN INVENTED. That screen proved the
 * shape — one question at a time, a bar that shows how much is left, and back
 * stepping through the form instead of throwing it away. The admin's Create
 * Order and Vendor Onboard want the same thing, and the third copy is where a
 * pattern becomes a component.
 *
 * WHAT IT DOES NOT DO: it does not render your steps, hold your form state, or
 * decide what "next" means. A wizard's steps differ per screen — some skip,
 * some gate on a server answer — and hiding that in a shell would make the
 * interesting part invisible. This owns position and movement; the screen owns
 * meaning.
 *
 * PAIR IT WITH `FooterAction`, whose label names the blocker when a step is not
 * finished. A greyed "Next" with no reason is the failure these forms exist to
 * remove.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Theme } from '../theme';

const EASE = Easing.out(Easing.cubic);
const MOTION = { duration: Theme.motion.durationMs, easing: EASE } as const;

/**
 * Minimal navigation surface the hook needs. Typed structurally rather than
 * against a navigator, so a wizard can be unit-tested with a plain object and
 * does not care which stack it sits in.
 */
interface WizardNav {
  goBack: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addListener: (type: any, cb: any) => () => void;
}

export interface Wizard<T extends string> {
  /** The step on screen. */
  step: T;
  /** Its position, 0-based. Clamped, so a step dropped mid-flow cannot crash. */
  index: number;
  /** True on the final step — the one whose footer commits. */
  isLast: boolean;
  /** Jump to a named step. Records the direction travelled. */
  goTo: (next: T) => void;
  /** One step back, or out of the screen entirely from the first. */
  back: () => void;
  /** One step on. A no-op at the end, so a footer cannot walk off the array. */
  forward: () => void;
  /** 1 forward, -1 backward — for a screen that animates its steps. */
  direction: 1 | -1;
  /**
   * "The form is done — stop guarding the exit."
   *
   * CALL THIS BEFORE NAVIGATING AWAY ON SUCCESS, and the back guard below will
   * let the screen go. Without it, `navigation.replace()` or `goBack()` after a
   * successful submit fires `beforeRemove`, the guard treats it as a stray back
   * press and steps BACKWARDS — so the record is created and the admin is
   * stranded on the previous step, looking at a form they have already
   * submitted. `navigate()` to a NEW screen pushes rather than removes and was
   * never affected, which is exactly why this was missed.
   */
  finish: () => void;
}

/**
 * Position and movement for a step-by-step form.
 *
 * `steps` may change between renders — a step that only exists sometimes
 * (essentials, where a cycle offers none) simply is not in the array, and the
 * bar shortens with it.
 */
export function useWizard<T extends string>(steps: T[], navigation: WizardNav): Wizard<T> {
  const [step, setStep] = useState<T>(steps[0]);
  const [direction, setDirection] = useState<1 | -1>(1);
  /**
   * A ref, not state: it is read inside the `beforeRemove` handler during the
   * same tick it is set, and a state update would not have landed yet.
   */
  const finished = useRef(false);

  const index = Math.max(0, steps.indexOf(step));

  const goTo = useCallback((next: T) => {
    setDirection(steps.indexOf(next) >= steps.indexOf(step) ? 1 : -1);
    setStep(next);
  }, [steps, step]);

  const back = useCallback(() => {
    if (index <= 0) { navigation.goBack(); return; }
    goTo(steps[index - 1]);
  }, [index, steps, goTo, navigation]);

  const forward = useCallback(() => {
    if (index < steps.length - 1) goTo(steps[index + 1]);
  }, [index, steps, goTo]);

  /**
   * The hardware back button and the swipe-back gesture step BACKWARDS through
   * the form rather than discarding it. Only the first step leaves the screen,
   * which is what "back" means there.
   *
   * Without this an Android back tap on the last step throws away every answer
   * and returns to the menu — the one thing a wizard must never do.
   */
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: { preventDefault: () => void }) => {
      // A completed form is free to leave — see `finish`.
      if (finished.current) return;
      if (index <= 0) return;
      e.preventDefault();
      goTo(steps[index - 1]);
    });
    return unsubscribe;
  }, [navigation, index, steps, goTo]);

  const finish = useCallback(() => { finished.current = true; }, []);

  return { step, index, isLast: index === steps.length - 1, goTo, back, forward, direction, finish };
}

/**
 * How far through you are.
 *
 * A FILL FADING IN OVER A TRACK, not a colour swap. The track is always there,
 * so the bar shows how many questions there ARE — half of what a progress bar
 * is for — and only the fill moves. The fade is the app's control language:
 * `withTiming` on an ease-out, no spring, nothing that bounces. See the note on
 * `Theme.motion`.
 */
export function WizardProgress({ count, index }: { count: number; index: number }) {
  return (
    <View style={styles.row}>
      {Array.from({ length: count }, (_, i) => (
        <Segment key={i} on={i <= index} />
      ))}
    </View>
  );
}

function Segment({ on }: { on: boolean }) {
  const t = useSharedValue(on ? 1 : 0);
  useEffect(() => { t.value = withTiming(on ? 1 : 0, MOTION); }, [on, t]);
  const style = useAnimatedStyle(() => ({ opacity: t.value }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Theme.spacing.xs },
  track: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: Theme.colors.layout.divider,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Theme.colors.text.mint,
  },
});
