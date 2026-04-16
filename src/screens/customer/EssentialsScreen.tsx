/**
 * 1stOne F1 — Essentials Screen
 *
 * Browse essentials catalog, add to essentials cart,
 * view cart summary, proceed to checkout.
 * Feature-flagged — only visible when essentials_module_active.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { useEssentialsCatalog } from '../../hooks/useEssentials';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useEssentialsCartStore } from '../../store/essentialsCartStore';
import type { EssentialItem } from '../../types';

function EssentialItemCard({
  item,
  quantity,
  onAdd,
  onInc,
  onDec,
}: {
  item: EssentialItem;
  quantity: number;
  onAdd: () => void;
  onInc: () => void;
  onDec: () => void;
}) {
  return (
    <View style={styles.itemCard}>
      <View style={styles.itemInfo}>
        <ThemedText variant="body" color="primary">{item.name}</ThemedText>
        <ThemedText variant="small" color="subtitle">
          {'\u20B9'}{item.price} / {item.unit}
        </ThemedText>
      </View>
      {quantity === 0 ? (
        <TouchableOpacity style={styles.addBtn} onPress={onAdd}>
          <ThemedText variant="small" color="primary">ADD</ThemedText>
        </TouchableOpacity>
      ) : (
        <View style={styles.stepper}>
          <TouchableOpacity style={styles.stepBtn} onPress={onDec}>
            <ThemedText variant="body" color="primary">-</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="body" color="primary" style={styles.qty}>
            {quantity}
          </ThemedText>
          <TouchableOpacity style={styles.stepBtn} onPress={onInc}>
            <ThemedText variant="body" color="primary">+</ThemedText>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function EssentialsScreen({ navigation }: { navigation: any }) {
  const [cycleFilter, setCycleFilter] = useState<number | undefined>(undefined);

  const { data: cycles } = useDeliveryCycles();
  const essentialsCycles = (cycles ?? []).filter((c) => c.is_essentials);

  const { data: catalog, isLoading, isError, refetch } = useEssentialsCatalog(cycleFilter);

  const cartItems = useEssentialsCartStore((s) => s.items);
  const addItem = useEssentialsCartStore((s) => s.addItem);
  const updateQuantity = useEssentialsCartStore((s) => s.updateQuantity);
  const getItemCount = useEssentialsCartStore((s) => s.getItemCount);
  const getDisplayTotal = useEssentialsCartStore((s) => s.getDisplayTotal);

  const cartCount = getItemCount();
  const cartTotal = getDisplayTotal();

  const getQuantity = useCallback(
    (itemId: number) => {
      const found = cartItems.find((i) => i.essential_item_id === itemId);
      return found?.quantity ?? 0;
    },
    [cartItems]
  );

  const renderItem = ({ item }: { item: EssentialItem }) => (
    <EssentialItemCard
      item={item}
      quantity={getQuantity(item.id)}
      onAdd={() =>
        addItem({
          essential_item_id: item.id,
          cycle_id: item.cycle_id,
          name: item.name,
          display_price: item.price,
          unit: item.unit,
        })
      }
      onInc={() => updateQuantity(item.id, getQuantity(item.id) + 1)}
      onDec={() => updateQuantity(item.id, getQuantity(item.id) - 1)}
    />
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">{'< Back'}</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Essentials</ThemedText>
        <View style={{ width: 50 }} />
      </View>

      {/* Cycle Tabs */}
      {essentialsCycles.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.cycleBar}
          contentContainerStyle={styles.cycleBarContent}
        >
          <TouchableOpacity
            style={[styles.cycleTab, !cycleFilter && styles.cycleTabActive]}
            onPress={() => setCycleFilter(undefined)}
          >
            <ThemedText variant="small" color={!cycleFilter ? 'primary' : 'subtitle'}>
              All
            </ThemedText>
          </TouchableOpacity>
          {essentialsCycles.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.cycleTab, cycleFilter === c.id && styles.cycleTabActive]}
              onPress={() => setCycleFilter(c.id)}
            >
              <ThemedText
                variant="small"
                color={cycleFilter === c.id ? 'primary' : 'subtitle'}
              >
                {c.cycle_name}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Catalog */}
      {isError ? (
        <ErrorRetry message="Failed to load essentials" onRetry={refetch} />
      ) : (
        <FlatList
          data={catalog ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={Theme.colors.action.primary}
            />
          }
          ListEmptyComponent={
            !isLoading ? <EmptyState title="No essentials available" /> : null
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Cart Summary FAB */}
      {cartCount > 0 && (
        <TouchableOpacity
          style={styles.cartFab}
          onPress={() => navigation.navigate('Checkout', { cartType: 'essentials' })}
        >
          <ThemedText variant="body" color="primary">
            {cartCount} item(s) — {'\u20B9'}{cartTotal.toFixed(0)}
          </ThemedText>
          <ThemedText variant="small" color="primary">
            Checkout {'>'}
          </ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Theme.spacing.md, paddingTop: Theme.spacing.xl + Theme.spacing.md, paddingBottom: Theme.spacing.sm },
  cycleBar: { maxHeight: 44 },
  cycleBarContent: { paddingHorizontal: Theme.spacing.md, gap: Theme.spacing.sm },
  cycleTab: { paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm, borderRadius: Theme.components.inputRadius, backgroundColor: Theme.colors.background.tertiary },
  cycleTabActive: { backgroundColor: Theme.colors.action.primary },
  list: { padding: Theme.spacing.md, paddingBottom: 100 },
  itemCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Theme.colors.background.secondary, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.md, marginBottom: Theme.spacing.sm },
  itemInfo: { flex: 1, marginRight: Theme.spacing.sm },
  addBtn: { backgroundColor: Theme.colors.action.primary, paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm, borderRadius: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: Theme.colors.background.tertiary, borderRadius: 8, overflow: 'hidden' },
  stepBtn: { paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm },
  qty: { minWidth: 30, textAlign: 'center' },
  cartFab: { position: 'absolute', bottom: Theme.spacing.lg, left: Theme.spacing.md, right: Theme.spacing.md, backgroundColor: Theme.colors.action.primary, borderRadius: Theme.components.inputRadius, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.md },
});
