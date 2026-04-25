/**
 * 1stOne F1 — Create Menu Screen
 *
 * Define a named menu for a cycle, with individual sub-items (qty each).
 * Sub-items are kitchen prep tasks — when a customer orders this menu,
 * the kitchen tab shows each sub-item × quantity ordered.
 *
 * Cycle toggle: tap the title text to cycle through Breakfast → Lunch → …
 * Sub-items are stored as JSON in menu_items.ingredients.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import {
  useAddMenuItem,
  useAllDeliveryCycles,
} from '../../hooks/useMenuManagement';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;

const MEAL_CYCLES = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'];

type SubItem = { name: string; qty: string };

export function CreateMenuScreen({ navigation, route }: AdminScreenProps<'CreateMenu'>) {
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  const cycles = rawCycles.filter((c: any) =>
    MEAL_CYCLES.some((m) => c.cycle_name?.toLowerCase().includes(m.toLowerCase()))
  );
  const addMenuItem = useAddMenuItem();

  const [cycleIdx, setCycleIdx] = useState(0);
  const [menuName, setMenuName] = useState('');
  const [subItems, setSubItems] = useState<SubItem[]>([]);
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState('');

  // Sync initial cycle from navigation param once cycles load
  useEffect(() => {
    if (!cycles.length) return;
    const paramId = route.params?.cycleId;
    if (!paramId || paramId === 0) return;
    const idx = cycles.findIndex((c: any) => c.id === paramId);
    if (idx >= 0) setCycleIdx(idx);
  }, [cycles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCycle = cycles[cycleIdx];
  const cycleLabel = selectedCycle ? `${selectedCycle.cycle_name} Menu` : 'Select cycle  ›';

  const handleCycleToggle = () => {
    if (!cycles.length) return;
    setCycleIdx((p) => (p + 1) % cycles.length);
  };

  const handleAddSubItem = () => {
    const name = itemName.trim();
    if (!name) return;
    setSubItems((prev) => [...prev, { name, qty: itemQty.trim() || '1' }]);
    setItemName('');
    setItemQty('');
  };

  const handleRemove = (idx: number) => {
    setSubItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    if (!menuName.trim()) {
      Alert.alert('Error', 'Enter a menu name');
      return;
    }
    if (!selectedCycle) {
      Alert.alert('Error', 'No delivery cycles available');
      return;
    }
    addMenuItem.mutate(
      {
        cycle_id: selectedCycle.id,
        name: menuName.trim(),
        price: 0,
        ingredients: subItems.length ? JSON.stringify(subItems) : undefined,
      },
      { onSuccess: () => navigation.goBack() }
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
          Create Menu
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Cycle toggle — tap to cycle */}
        <TouchableOpacity style={styles.cycleRow} onPress={handleCycleToggle} activeOpacity={0.7}>
          <ThemedText variant="body" color="mint" style={styles.txt}>
            {cycleLabel}{'  ›'}
          </ThemedText>
        </TouchableOpacity>

        {/* Menu name */}
        <TextInput
          style={styles.input}
          placeholder="Menu name  (e.g. Breakfast Thali)"
          placeholderTextColor={Theme.colors.text.muted}
          value={menuName}
          onChangeText={setMenuName}
        />

        {/* Sub-item entry row */}
        <View style={styles.subEntryRow}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder="Item  (e.g. Idli)"
            placeholderTextColor={Theme.colors.text.muted}
            value={itemName}
            onChangeText={setItemName}
            onSubmitEditing={handleAddSubItem}
            returnKeyType="next"
          />
          <TextInput
            style={[styles.input, styles.qtyInput]}
            placeholder="Qty"
            placeholderTextColor={Theme.colors.text.muted}
            value={itemQty}
            onChangeText={setItemQty}
            onSubmitEditing={handleAddSubItem}
            returnKeyType="done"
          />
          <TouchableOpacity style={styles.addBtn} onPress={handleAddSubItem}>
            <ThemedText variant="body" color="mint" style={styles.txt}>+</ThemedText>
          </TouchableOpacity>
        </View>

        {/* Sub-items list */}
        {subItems.length > 0 && (
          <View style={styles.subList}>
            {subItems.map((si, idx) => (
              <View key={idx} style={styles.subRow}>
                <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]}>
                  {si.name}
                </ThemedText>
                <ThemedText variant="body" color="subtitle" style={styles.txt}>
                  {si.qty}
                </ThemedText>
                <TouchableOpacity onPress={() => handleRemove(idx)} hitSlop={{ top: 8, bottom: 8, left: 12, right: 4 }}>
                  <ThemedText variant="body" color="muted" style={[styles.txt, styles.removeX]}>×</ThemedText>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Save footer */}
      <TouchableOpacity
        style={styles.footer}
        onPress={handleSave}
        disabled={addMenuItem.isPending}
        activeOpacity={0.7}
      >
        <ThemedText
          variant="body"
          color={addMenuItem.isPending ? 'muted' : 'mint'}
          style={styles.txt}
        >
          {addMenuItem.isPending ? 'Saving...' : 'Save Menu  ›'}
        </ThemedText>
      </TouchableOpacity>
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

  scroll: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl * 2,
  },

  cycleRow: {
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    alignSelf: 'flex-start',
    marginBottom: Theme.spacing.md,
  },

  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },

  subEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.xs,
  },
  flex1: { flex: 1 },
  qtyInput: { width: 64, marginBottom: Theme.spacing.sm },
  addBtn: {
    paddingHorizontal: Theme.spacing.sm,
    paddingBottom: Theme.spacing.sm,
  },

  subList: {
    marginTop: Theme.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  removeX: {
    fontSize: B + 4,
    marginLeft: Theme.spacing.sm,
    color: Theme.colors.text.muted,
  },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },

  txt: { fontSize: B },
});
