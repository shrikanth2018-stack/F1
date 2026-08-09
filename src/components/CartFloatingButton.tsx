/**
 * 1stOne F1 — CartFloatingButton
 *
 * Circular cart button with a count badge, bottom-right.
 *
 * TWO DELIBERATE CHOICES.
 *
 * 1. THE COUNT IS BOTH CARTS ADDED TOGETHER. It used to show only the cart
 *    matching the tab you were looking at, so adding an idli and then tapping
 *    Essentials made the button vanish — the item was still there, but nothing
 *    on screen said so and a customer would reasonably think they had lost it.
 *    The number is now everything the customer is holding, whichever tab they
 *    are on. (The Cart screen still groups those items by delivery window, so
 *    nothing is muddled once they get there.)
 *
 * 2. BOTTOM-RIGHT, NOT A FULL-WIDTH BAR. This is the most-tapped control on
 *    Home after the row +, so it sits in the easy thumb zone. A full-width bar
 *    stacked with the plans button used to occlude roughly 15% of the list.
 *    The side rails live higher up the right edge and are cleared by the
 *    bottom offset below.
 *
 * The rupee total is deliberately not shown: it would widen the button enough
 * to cover a row's + control, and it is one tap away on the Cart screen.
 */

import React from 'react';
import { TouchableOpacity, View, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { useCartStore } from '../store/cartStore';
import { useEssentialsCartStore } from '../store/essentialsCartStore';

interface CartFloatingButtonProps {
  onPress: () => void;
}

export function CartFloatingButton({ onPress }: CartFloatingButtonProps) {
  const insets = useSafeAreaInsets();
  const foodCount = useCartStore((s) => s.getItemCount());
  const essCount = useEssentialsCartStore((s) => s.getItemCount());
  const itemCount = foodCount + essCount;

  if (itemCount === 0) return null;

  return (
    <TouchableOpacity
      style={[styles.fab, { bottom: insets.bottom + Theme.spacing.lg }]}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
    >
      <Ionicons name="cart-outline" size={26} color={Theme.colors.text.mint} />
      <View style={styles.badge}>
        <Text style={styles.badgeText} numberOfLines={1}>
          {itemCount > 99 ? '99+' : itemCount}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const SIZE = 56;

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: Theme.spacing.md,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Theme.colors.text.mint,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    // The theme's one red. Mint made the count read as decoration next to
    // every other mint accent on Home; red is the convention for "you have
    // items waiting" and is the only thing on the screen wearing it.
    backgroundColor: Theme.colors.status.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Theme.colors.background.primary,
  },
  badgeText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.micro,
    // White, not the near-black that suited the old mint badge. On red the
    // dark numeral measured an acceptable contrast ratio and was still hard
    // to read at 12pt — the screen overruled the arithmetic.
    color: Theme.colors.text.primary,
  },
});
