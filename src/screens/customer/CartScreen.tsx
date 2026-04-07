/**
 * 1stOne F1 — Cart Screen
 *
 * Shows all cart items grouped by delivery cycle.
 * Each item has quantity stepper and dispatch badge (Today/Tomorrow).
 * Bottom: subtotal (display only), checkout button.
 *
 * NOTE: Prices are display-only. Server recalculates at checkout.
 */

import React from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { DispatchBadge } from '../../components/DispatchBadge';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { useCartStore } from '../../store/cartStore';
import { useSmartCart } from '../../hooks/useSmartCart';
import { formatPriceShort } from '../../utils/formatters';
import type { CartItem } from '../../types';

export function CartScreen({ navigation }: any) {
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);
  const displayTotal = useCartStore((s) => s.getDisplayTotal());
  const { evaluations } = useSmartCart();

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          title="Cart is empty"
          subtitle="Add some delicious meals from the menu"
          actionLabel="Browse Menu"
          onAction={() => navigation.goBack()}
        />
      </SafeAreaView>
    );
  }

  const renderCartItem = ({ item }: { item: CartItem }) => {
    const dispatch = evaluations.find(
      (e) => e.menu_item_id === item.menu_item_id
    );

    return (
      <View style={styles.itemRow}>
        <View style={styles.itemInfo}>
          <ThemedText variant="body" color="primary">
            {item.name}
          </ThemedText>
          <View style={styles.itemMeta}>
            <ThemedText variant="small" color="subtitle">
              {formatPriceShort(item.display_price)} each
            </ThemedText>
            {dispatch && (
              <DispatchBadge
                label={dispatch.dispatch_label}
                variant={dispatch.scenario === 'A' ? 'today' : 'tomorrow'}
              />
            )}
          </View>
        </View>

        <View style={styles.itemRight}>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() =>
                item.quantity <= 1
                  ? removeItem(item.menu_item_id)
                  : updateQuantity(item.menu_item_id, item.quantity - 1)
              }
            >
              <ThemedText variant="body" color="primary">
                −
              </ThemedText>
            </TouchableOpacity>
            <ThemedText variant="body" color="primary" style={styles.qty}>
              {item.quantity}
            </ThemedText>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() =>
                updateQuantity(item.menu_item_id, item.quantity + 1)
              }
            >
              <ThemedText variant="body" color="primary">
                +
              </ThemedText>
            </TouchableOpacity>
          </View>
          <ThemedText variant="body" color="accent">
            {formatPriceShort(item.display_price * item.quantity)}
          </ThemedText>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">
            ‹ Back
          </ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">
          Cart
        </ThemedText>
        <TouchableOpacity onPress={clearCart}>
          <ThemedText variant="small" color="muted">
            Clear
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Items */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.menu_item_id.toString()}
        renderItem={renderCartItem}
        ItemSeparatorComponent={() => <Divider />}
        contentContainerStyle={styles.listContent}
      />

      {/* Footer: Total + Checkout */}
      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <ThemedText variant="body" color="subtitle">
            Subtotal (approx.)
          </ThemedText>
          <ThemedText variant="subtitle" color="primary">
            {formatPriceShort(displayTotal)}
          </ThemedText>
        </View>
        <ThemedText variant="micro" color="muted" style={styles.disclaimer}>
          Final amount calculated at checkout including tax and delivery
        </ThemedText>
        <ThemedButton
          title="Proceed to Checkout"
          onPress={() => navigation.navigate('Checkout')}
          style={styles.checkoutBtn}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  listContent: {
    paddingHorizontal: Theme.spacing.md,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
  },
  itemInfo: {
    flex: 1,
    marginRight: Theme.spacing.sm,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  itemRight: {
    alignItems: 'flex-end',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.background.card,
    borderRadius: 8,
    marginBottom: 4,
  },
  stepBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  qty: {
    minWidth: 24,
    textAlign: 'center',
  },
  footer: {
    padding: Theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.layout.divider,
    backgroundColor: Theme.colors.background.card,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  disclaimer: {
    marginTop: 4,
    marginBottom: Theme.spacing.sm,
  },
  checkoutBtn: {
    marginTop: Theme.spacing.xs,
  },
});
