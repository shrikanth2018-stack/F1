/**
 * 1stOne F1 — CartFloatingButton
 * Solid green pill, white text, floats above the bottom bar.
 */

import React from 'react';
import { TouchableOpacity, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../theme';
import { useCartStore } from '../store/cartStore';
import { useEssentialsCartStore } from '../store/essentialsCartStore';
import { formatPriceShort } from '../utils/formatters';

interface CartFloatingButtonProps {
  onPress: () => void;
  cartType?: 'food' | 'essentials';
}

export function CartFloatingButton({ onPress, cartType = 'food' }: CartFloatingButtonProps) {
  const insets = useSafeAreaInsets();
  const foodCount = useCartStore((s) => s.getItemCount());
  const foodTotal = useCartStore((s) => s.getDisplayTotal());
  const essCount = useEssentialsCartStore((s) => s.getItemCount());
  const essTotal = useEssentialsCartStore((s) => s.getDisplayTotal());

  const itemCount = cartType === 'food' ? foodCount : essCount;
  const displayTotal = cartType === 'food' ? foodTotal : essTotal;

  if (itemCount === 0) return null;

  return (
    <TouchableOpacity
      style={[styles.fab, { bottom: insets.bottom + 58 }]}
      activeOpacity={0.88}
      onPress={onPress}
    >
      <Text style={styles.text}>{itemCount} {itemCount === 1 ? 'item' : 'items'}</Text>
      <Text style={styles.text}>{formatPriceShort(displayTotal)}</Text>
      <Text style={styles.text}>View Cart ›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    left: Theme.spacing.md,
    right: Theme.spacing.md,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    shadowColor: Theme.colors.text.mint,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  text: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    fontWeight: '600',
  },
});
