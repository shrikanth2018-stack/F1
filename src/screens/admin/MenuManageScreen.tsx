/**
 * 1stOne F1 — Menu Manager
 *
 * Lists menus per cycle (toggle tap cycles through Breakfast → Lunch → …).
 * Each row: menu name | tap-to-edit price | enable/disable switch.
 * Footer: "+ Add new item" → CreateMenuScreen.
 *
 * Sub-items (kitchen prep components) are stored as JSON in menu_items.ingredients.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import {
  useAllMenuItems,
  useUpdateMenuItem,
  useToggleMenuItem,
  useAllDeliveryCycles,
} from '../../hooks/useMenuManagement';
import type { MenuItem } from '../../types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;
const P = Theme.typography.sizes.body + 4;   // price text

/** Parse components stored as JSON in ingredients field */
function parseComponents(raw?: string | null): { name: string; qty: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // legacy plain-text ingredients — show as single entry
    return [{ name: raw, qty: '' }];
  }
  return [];
}

const MEAL_CYCLES = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'];

export function MenuManageScreen({ navigation }: { navigation: any }) {
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  // Only the 4 meal cycles — essentials has its own screen
  const cycleOptions = useMemo(
    () => rawCycles.filter((c: any) =>
      MEAL_CYCLES.some((m) => c.cycle_name?.toLowerCase().includes(m.toLowerCase()))
    ),
    [rawCycles]
  );
  const [cycleIdx, setCycleIdx] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState('');

  const updateItem = useUpdateMenuItem();
  const toggleItem = useToggleMenuItem();

  const selected = cycleOptions[cycleIdx] ?? cycleOptions[0];
  const { data: items = [], isLoading } = useAllMenuItems(selected?.id);

  const cycleLabel = selected ? `${selected.cycle_name} Menu` : 'Loading…';

  const handleCycleToggle = () => {
    setCycleIdx((p) => (p + 1) % cycleOptions.length);
  };

  const handlePriceTap = (item: MenuItem) => {
    setEditingId(item.id);
    setPriceInput(String(item.price));
  };

  const commitPrice = (id: number) => {
    const price = parseFloat(priceInput);
    if (!isNaN(price) && price >= 0) {
      updateItem.mutate({ id, price });
    }
    setEditingId(null);
  };

  const handleToggle = (id: number, current: boolean) => {
    toggleItem.mutate({ id, is_active: !current });
  };

  const renderItem = ({ item }: { item: MenuItem }) => {
    const components = parseComponents(item.ingredients);
    const isEditingPrice = editingId === item.id;

    return (
      <View style={[styles.row, !item.is_active && styles.rowDim]}>
        <View style={styles.rowLeft}>
          <ThemedText variant="body" color="primary" style={styles.rowText} numberOfLines={1}>
            {item.name}
          </ThemedText>

          {components.length > 0 && (
            <ThemedText variant="small" color="muted" style={styles.components} numberOfLines={1}>
              {components.map((c) => `${c.name}${c.qty ? ` ×${c.qty}` : ''}`).join('  ·  ')}
            </ThemedText>
          )}

          {isEditingPrice ? (
            <TextInput
              style={styles.priceInput}
              value={priceInput}
              onChangeText={setPriceInput}
              keyboardType="numeric"
              autoFocus
              onBlur={() => commitPrice(item.id)}
              onSubmitEditing={() => commitPrice(item.id)}
              returnKeyType="done"
            />
          ) : (
            <TouchableOpacity onPress={() => handlePriceTap(item)} activeOpacity={0.7}>
              <ThemedText variant="small" color="mint" style={styles.price}>
                ₹{item.price > 0 ? item.price : '—'}{'  ✎'}
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>

        <Switch
          value={item.is_active}
          onValueChange={() => handleToggle(item.id, item.is_active)}
          trackColor={{
            true: Theme.colors.status.success,
            false: Theme.colors.background.tertiary,
          }}
          thumbColor={Theme.colors.text.primary}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Menu Manager
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      {/* Cycle toggle — tap the text to cycle */}
      <TouchableOpacity style={styles.cycleRow} onPress={handleCycleToggle} activeOpacity={0.7}>
        <ThemedText variant="body" color="mint" style={styles.cycleText}>
          {cycleLabel}{'  ›'}
        </ThemedText>
      </TouchableOpacity>

      {/* Menu list */}
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState title="No menus for this cycle" subtitle={'Tap "+ Add new item" below'} />
          ) : null
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />

      {/* Footer */}
      <View style={styles.footerRow}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ImportItems', { type: 'menu' })}
        >
          <ThemedText variant="body" color="muted" style={styles.rowText}>
            Import CSV{'  ›'}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('CreateMenu', {
              cycleId: selected?.id,
              cycleName: selected?.cycle_name,
            })
          }
        >
          <ThemedText variant="body" color="mint" style={styles.rowText}>
            + Add new item{'  ›'}
          </ThemedText>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  cycleRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    alignSelf: 'flex-start',
  },
  cycleText: { fontSize: B },

  list: { paddingBottom: Theme.spacing.xl },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  rowDim: { opacity: 0.45 },
  rowLeft: { flex: 1, marginRight: Theme.spacing.sm },
  rowText: { fontSize: B },
  components: { fontSize: S, marginTop: 2 },
  price: { fontSize: P, marginTop: 6 },
  priceInput: {
    marginTop: 6,
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: P,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: 2,
    minWidth: 80,
  },

  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
});
