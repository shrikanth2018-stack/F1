/**
 * 1stOne F1 — Customer Home Screen
 *
 * Layout:
 * - Banner carousel (top)
 * - Delivery cycle tabs (horizontal pill selector)
 * - Menu items list (FlatList, filtered by active cycle)
 * - Floating cart button (bottom, visible when cart has items)
 *
 * All data from Supabase via TanStack Query hooks.
 */

import React, { useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { MenuItemCard } from '../../components/MenuItemCard';
import { BannerCarousel } from '../../components/BannerCarousel';
import { CartFloatingButton } from '../../components/CartFloatingButton';
import { ErrorRetry } from '../../components/ErrorRetry';
import { EmptyState } from '../../components/EmptyState';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useMenuItems } from '../../hooks/useMenuItems';
import { useBanners } from '../../hooks/useBanners';
import { useSmartCart } from '../../hooks/useSmartCart';
import { useCartStore } from '../../store/cartStore';
import { useUIStore } from '../../store/uiStore';
import { formatTime12h } from '../../utils/timeEngine';
import type { MenuItem } from '../../types';

export function HomeScreen({ navigation }: any) {
  const activeCycleId = useUIStore((s) => s.activeCycleId);
  const setActiveCycleId = useUIStore((s) => s.setActiveCycleId);

  const {
    data: cycles,
    isLoading: cyclesLoading,
    error: cyclesError,
    refetch: refetchCycles,
  } = useDeliveryCycles();

  const {
    data: menuItems,
    isLoading: menuLoading,
    error: menuError,
    refetch: refetchMenu,
  } = useMenuItems(activeCycleId);

  const { data: banners } = useBanners();
  const { evaluations } = useSmartCart();

  // Auto-select first cycle if none selected
  React.useEffect(() => {
    if (cycles && cycles.length > 0 && !activeCycleId) {
      setActiveCycleId(cycles[0].id);
    }
  }, [cycles, activeCycleId, setActiveCycleId]);

  // Cart actions
  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const items = useCartStore((s) => s.items);

  const getItemQuantity = useCallback(
    (menuItemId: number) => {
      const cartItem = items.find((i) => i.menu_item_id === menuItemId);
      return cartItem?.quantity ?? 0;
    },
    [items]
  );

  const getDispatchInfo = useCallback(
    (menuItemId: number) => {
      return evaluations.find((e) => e.menu_item_id === menuItemId);
    },
    [evaluations]
  );

  const handleRefresh = useCallback(() => {
    refetchCycles();
    refetchMenu();
  }, [refetchCycles, refetchMenu]);

  if (cyclesError || menuError) {
    return (
      <ErrorRetry
        message="Could not load menu. Please try again."
        onRetry={handleRefresh}
      />
    );
  }

  const imageBanners = (banners ?? [])
    .filter((b) => b.banner_type === 'image' && b.image_url)
    .map((b) => ({ id: b.id, image_url: b.image_url! }));

  const renderMenuItem = ({ item }: { item: MenuItem }) => {
    const qty = getItemQuantity(item.id);
    const dispatch = getDispatchInfo(item.id);

    return (
      <MenuItemCard
        item={item}
        quantity={qty}
        dispatchLabel={dispatch?.dispatch_label}
        dispatchScenario={dispatch?.scenario}
        onAdd={() =>
          addItem({
            menu_item_id: item.id,
            cycle_id: item.cycle_id,
            name: item.name,
            display_price: item.price,
          })
        }
        onIncrement={() => updateQuantity(item.id, qty + 1)}
        onDecrement={() =>
          qty <= 1 ? removeItem(item.id) : updateQuantity(item.id, qty - 1)
        }
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <ThemedText variant="header" color="primary">
          1stOne
        </ThemedText>
        <ThemedText variant="micro" color="muted">
          Pure Vegetarian
        </ThemedText>
      </View>

      {/* Cycle Tabs */}
      {cycles && cycles.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabContent}
        >
          {cycles.map((cycle) => {
            const isActive = cycle.id === activeCycleId;
            return (
              <TouchableOpacity
                key={cycle.id}
                style={[styles.tab, isActive && styles.tabActive]}
                activeOpacity={0.7}
                onPress={() => setActiveCycleId(cycle.id)}
              >
                <ThemedText
                  variant="small"
                  color={isActive ? 'primary' : 'muted'}
                >
                  {cycle.cycle_name}
                </ThemedText>
                <ThemedText variant="micro" color={isActive ? 'primary' : 'muted'}>
                  by {formatTime12h(cycle.delivery_start)}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Menu Items */}
      <FlatList
        data={menuItems ?? []}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderMenuItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={menuLoading}
            onRefresh={handleRefresh}
            tintColor={Theme.colors.action.primary}
          />
        }
        ListHeaderComponent={
          imageBanners.length > 0 ? (
            <BannerCarousel banners={imageBanners} />
          ) : null
        }
        ListEmptyComponent={
          !menuLoading ? (
            <EmptyState
              title="No items available"
              subtitle="Check back soon for fresh meals"
            />
          ) : null
        }
      />

      {/* Cart FAB */}
      <CartFloatingButton
        onPress={() => navigation.navigate('Cart')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },
  tabScroll: {
    maxHeight: 60,
  },
  tabContent: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.card,
    alignItems: 'center',
    marginRight: 8,
  },
  tabActive: {
    backgroundColor: Theme.colors.action.primary,
  },
  listContent: {
    paddingTop: Theme.spacing.sm,
    paddingBottom: 100, // Space for cart FAB
  },
});
