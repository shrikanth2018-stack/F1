/**
 * 1stOne F1 — Essentials Manager
 *
 * Lists essentials per delivery cycle, displayed as Morning/Noon/Evening.
 * cycle_id links to the same delivery_cycles table used by menu_items —
 * so essentials are bundled with the matching meal delivery run.
 *
 * Toggle: Morning (Breakfast) → Noon (Lunch) → Afternoon (Snacks) → Evening (Dinner)
 * Each row: item name | tap-to-edit price | enable/disable switch.
 * Footer: Import CSV | + Add Essential Item
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
  useAllEssentials,
  useUpdateEssentialPrice,
  useToggleEssential,
  type EssentialItem,
} from '../../hooks/useEssentialsCatalog';
import { useAllDeliveryCycles } from '../../hooks/useMenuManagement';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const P = Theme.typography.sizes.body + 4;

export function EssentialsCatalogManageScreen({ navigation }: { navigation: AdminNavProp }) {
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  // Use essentials cycles only (is_essentials = true) — these are the actual cycles
  // used by essentials_catalog items and shown on the customer Essentials tab.
  const cycles = useMemo(
    () => rawCycles.filter((c: any) => c.is_essentials),
    [rawCycles]
  );

  const [cycleIdx, setCycleIdx] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState('');

  const updatePrice = useUpdateEssentialPrice();
  const toggleItem = useToggleEssential();

  const selectedCycle = cycles[cycleIdx] as any;
  const { data: items = [], isLoading } = useAllEssentials(selectedCycle?.id);

  const displayName = selectedCycle ? selectedCycle.cycle_name : '…';
  const cycleLabel = `${displayName} Essentials`;

  const handleCycleToggle = () => {
    if (!cycles.length) return;
    setCycleIdx((p) => (p + 1) % cycles.length);
  };

  const handlePriceTap = (item: EssentialItem) => {
    setEditingId(item.id);
    setPriceInput(String(item.price));
  };

  const commitPrice = (id: number) => {
    const price = parseFloat(priceInput);
    if (!isNaN(price) && price >= 0) updatePrice.mutate({ id, price });
    setEditingId(null);
  };

  const handleToggle = (id: number, current: boolean) => {
    toggleItem.mutate({ id, is_active: !current });
  };

  const renderItem = ({ item }: { item: EssentialItem }) => {
    const isEditingPrice = editingId === item.id;
    return (
      <View style={[styles.row, !item.is_active && styles.rowDim]}>
        <View style={styles.rowLeft}>
          <ThemedText variant="body" color="primary" style={styles.rowText} numberOfLines={1}>
            {item.name}
          </ThemedText>

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
                {'₹'}{item.price > 0 ? item.price : '—'}{'  ✎'}
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>

        <Switch
          value={item.is_active}
          onValueChange={() => handleToggle(item.id, item.is_active)}
          trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
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
          Essentials Manager
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      {/* Cycle toggle — Morning/Noon/Afternoon/Evening */}
      <TouchableOpacity style={styles.cycleRow} onPress={handleCycleToggle} activeOpacity={0.7}>
        <ThemedText variant="body" color="mint" style={styles.cycleText}>
          {cycleLabel}{'  ›'}
        </ThemedText>
      </TouchableOpacity>

      {/* List */}
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState title={`No essentials for ${displayName}`} subtitle={'Tap "+ Add Essential Item" below'} />
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
          onPress={() => navigation.navigate('ImportItems', { type: 'essentials' })}
        >
          <ThemedText variant="body" color="muted" style={styles.rowText}>
            Import CSV{'  ›'}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('CreateEssential', { cycleId: selectedCycle?.id, cycleName: selectedCycle?.cycle_name })
          }
        >
          <ThemedText variant="body" color="mint" style={styles.rowText}>
            + Add Essential Item{'  ›'}
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
