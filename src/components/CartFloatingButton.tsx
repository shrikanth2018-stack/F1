/**
 * 1stOne F1 — CartFloatingButton
 *
 * Floating action button showing cart item count + total.
 * Tapping opens the CartSheet. Only visible when cart has items.
 */

import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';
import { useCartStore } from '../store/cartStore';
import { formatPriceShort } from '../utils/formatters';

interface CartFloatingButtonProps {
  onPress: () => void;
}

export function CartFloatingButton({ onPress }: CartFloatingButtonProps) {
  const itemCount = useCartStore((s) => s.getItemCount());
  const displayTotal = useCartStore((s) => s.getDisplayTotal());

  if (itemCount === 0) return null;

  return (
    <TouchableOpacity
      style={styles.fab}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View style={styles.left}>
        <ThemedText variant="body" color="primary">
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </ThemedText>
        <ThemedText variant="small" color="primary">
          {formatPriceShort(displayTotal)}
        </ThemedText>
      </View>
      <ThemedText variant="body" color="primary">
        View Cart ›
      </ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 16,
    left: Theme.spacing.md,
    right: Theme.spacing.md,
    backgroundColor: Theme.colors.action.primary,
    borderRadius: Theme.components.inputRadius,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  left: {
    flexDirection: 'column',
  },
});
