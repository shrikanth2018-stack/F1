/**
 * 1stOne F1 — ScreenHeader
 *
 * The top of every page reached from the profile menu. One component, because
 * eleven hand-rolled copies is exactly how they came to disagree.
 *
 * WHAT THEY LOOKED LIKE BEFORE. Seven pages put the title on the left and
 * "Close" on the right; four put "‹ Back" on the left and the title after it.
 * So the control a customer reaches for MOVED SIDES depending on which page
 * they were on — the one inconsistency muscle memory cannot absorb. Underneath
 * that, four different sets of padding, a divider on four of eleven, and
 * `hitSlop` on some rows and not others.
 *
 * THE SHAPE, decided by the owner:
 *
 *     My Wallet                                              Close
 *     ────────────────────────────────────────────────────────────
 *
 * Title left, at one size and one colour everywhere. Exactly ONE control, top
 * right. Never both a Back and a Close — if the control has no job, it should
 * not be there, and if it has one, one word is enough.
 *
 * THE WORD IS DERIVED, NOT DECLARED. Every one of these calls `goBack()`, so
 * "Close" and "Back" were the same operation labelled two ways. What actually
 * differs is where you land:
 *
 *     Home is underneath   →  "Close"   (a leaf off the profile menu)
 *     a page is underneath →  "Back"    (you came from somewhere real)
 *
 * Read from the navigation stack at render, so no screen has to declare it and
 * nothing can drift as routes are added. Add a page tomorrow and it labels
 * itself correctly on the first run.
 */

import React, { useCallback, useContext } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface ScreenHeaderProps {
  /** Shown left. May be dynamic — a hub's own name, a vendor's trading name. */
  title: string;
  /**
   * Override the dismiss action. Only for a screen where `goBack()` is the
   * wrong answer; see PlanDetail, which can be reached from three places.
   */
  onDismiss?: () => void;
  /**
   * Force the word. Almost never needed — the derivation below is right for
   * every page in the stack today. Present so a screen with a genuinely odd
   * dismissal (an `onDismiss` that does not go back) can still name itself
   * honestly rather than lying in one word. PlanDetail is the one case: it
   * resets to Home from three different entry points, so "Back" would be
   * false however it was reached.
   */
  label?: 'Back' | 'Close';
  /**
   * One optional action for this page — Cart's "Clear All" is the only one.
   *
   * It sits INSIDE the dismiss control, never outside it: the owner's rule is
   * that leaving is always the rightmost thing, so a customer never has to
   * check which page they are on to know where the exit is. That also gives
   * the header a readable order — left is where am I, right is how do I
   * leave, and anything in between is what I can do here.
   *
   * Rendered in accent, or error when destructive, so it cannot be mistaken
   * for the muted chrome of the dismiss word beside it.
   */
  action?: { label: string; onPress: () => void; destructive?: boolean };
}

export function ScreenHeader({ title, onDismiss, label, action }: ScreenHeaderProps) {
  /**
   * READ FROM THE CONTEXT, NOT `useNavigation()`. That hook THROWS outside a
   * NavigationContainer, and this component is a title and a button — it has
   * no business demanding a navigator in order to draw itself.
   *
   * That is not hypothetical here. `OnboardingScreen` renders OUTSIDE the
   * container (RootNavigator returns it before `<NavigationContainer>`), and
   * `AddAddressScreen` — which this header now sits on — already guards its
   * own dismissal with `navigation?.goBack()`, so somebody had anticipated it
   * being rendered without one. The hook would have crashed that path.
   * `CheckoutScreen`'s test caught the same thing from the other direction.
   *
   * `getState()` rather than `useNavigationState`: that hook also throws, and
   * what is beneath a screen cannot change while it is mounted, so there is
   * nothing here to stay subscribed to.
   */
  const navigation = useContext(NavigationContext);
  const state = navigation?.getState?.();
  /**
   * The route one below this one in the stack. `undefined` when this screen is
   * the root or there is no navigator at all — both read as "nothing to go
   * back to" → Close.
   */
  const beneath = state?.routes?.[state.index - 1]?.name;
  const derived: 'Back' | 'Close' =
    beneath == null || beneath === 'Home' ? 'Close' : 'Back';
  const word = label ?? derived;

  const handleDismiss = useCallback(() => {
    if (onDismiss) onDismiss();
    else navigation?.goBack();
  }, [onDismiss, navigation]);

  return (
    <View style={styles.header}>
      <ThemedText
        variant="header"
        color="primary"
        style={styles.title}
        numberOfLines={1}
      >
        {title}
      </ThemedText>
      {action && (
        <TouchableOpacity
          onPress={action.onPress}
          style={styles.action}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <ThemedText variant="body" color={action.destructive ? 'warning' : 'accent'}>
            {action.label}
          </ThemedText>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={handleDismiss}
        style={styles.control}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={word}
      >
        <ThemedText variant="body" color="muted">{word}</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * One height for every page, so a title cannot land a few points off where
   * the last page put it — which was the quiet half of the old inconsistency,
   * visible only when moving between two pages in succession.
   */
  header: {
    height: Theme.components.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  /** Takes the slack so a long title truncates instead of pushing the control
   *  off the edge. A hub's name and a vendor's trading name are both free text. */
  title: {
    flex: 1,
    marginRight: Theme.spacing.sm,
  },
  /**
   * A SIZE, not a `hitSlop`. Slop was applied on some of the old headers and
   * forgotten on others, and it is invisible — a target too small looks fine
   * right up until it is missed. A minimum size shows itself in the layout.
   */
  control: {
    minWidth: Theme.components.touchMin,
    minHeight: Theme.components.touchMin,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  /** Same target as the dismiss control, spaced off it so the two cannot be
   *  mis-tapped for each other — one of them clears a cart. */
  action: {
    minHeight: Theme.components.touchMin,
    justifyContent: 'center',
    marginRight: Theme.spacing.md,
  },
});
