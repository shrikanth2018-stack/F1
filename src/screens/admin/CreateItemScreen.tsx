/**
 * 1stOne F1 — Create Item (stage 1 of the menu builder)
 *
 * An ITEM is a priced building block — "Idli ₹12", "Vada ₹25". It is the
 * unit the kitchen actually prepares and the unit an admin can sell on its
 * own (bulk / back-office entry). It is NOT listed on the customer menu:
 * every row created here is written with is_customer_visible = false.
 *
 * Stage 2 (CreateMenuScreen) clubs these items into a customer-facing MENU
 * ITEM ("Idli Vada") which carries its own combination price.
 *
 * Why the name matters: the recipe of a menu item stores component NAMES
 * ("Idli:2;Vada:1"), and get_kitchen_aggregate merges prep lines by that
 * name. So an item's name is its identity — two items with the same name in
 * one cycle are blocked here, and ':' / ';' are rejected because they are
 * the recipe grammar's delimiters.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { infoDialog } from '../../utils/confirmDialog';
import {
  useAddMenuItem,
  useAllMenuItems,
  useAllDeliveryCycles,
} from '../../hooks/useMenuManagement';
import type { MenuItem } from '../../types';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

export function CreateItemScreen({ navigation, route }: AdminScreenProps<'CreateItem'>) {
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  // Active delivery cycles (already branch-scoped & sort_order-ordered by
  // useAllDeliveryCycles). Filter on is_active, not a cycle-name substring —
  // renaming a cycle must never drop it from the picker.
  const cycles = rawCycles.filter((c: any) => c.is_active);
  const addMenuItem = useAddMenuItem();

  const [cycleIdx, setCycleIdx] = useState(0);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');

  // Sync initial cycle from navigation param once cycles load
  useEffect(() => {
    if (!cycles.length) return;
    const paramId = route.params?.cycleId;
    if (!paramId || paramId === 0) return;
    const idx = cycles.findIndex((c: any) => c.id === paramId);
    if (idx >= 0) setCycleIdx(idx);
  }, [cycles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCycle = cycles[cycleIdx];
  const cycleLabel = selectedCycle ? `${selectedCycle.cycle_name} Items` : 'Select cycle  ›';

  // Existing items in this cycle — shown so the admin can see what already
  // exists before adding, and used for the duplicate-name guard.
  const { data: allInCycle = [] } = useAllMenuItems(selectedCycle?.id);
  const existingItems = useMemo(
    () => (allInCycle as MenuItem[]).filter((m) => m.is_customer_visible === false),
    [allInCycle],
  );

  const handleCycleToggle = () => {
    if (!cycles.length) return;
    setCycleIdx((p) => (p + 1) % cycles.length);
  };

  const handleSave = () => {
    const name = itemName.trim();
    if (!name) {
      infoDialog('Name required', 'Enter the item name.');
      return;
    }
    if (name.includes(':') || name.includes(';')) {
      infoDialog(
        'Invalid character',
        'Item names cannot contain ":" or ";" — they separate the parts of a menu item recipe.',
      );
      return;
    }
    if (!selectedCycle) {
      infoDialog('No cycle', 'No delivery cycles available.');
      return;
    }
    const price = parseFloat(itemPrice);
    if (!Number.isFinite(price) || price <= 0) {
      infoDialog(
        'Price required',
        'An item needs a price — it is what the item sells for on its own.',
      );
      return;
    }
    const clash = (allInCycle as MenuItem[]).find(
      (m) => m.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      infoDialog(
        'Name already used',
        `"${clash.name}" already exists in ${selectedCycle.cycle_name}. The kitchen groups prep by name, so each name must be used once per cycle.`,
      );
      return;
    }

    addMenuItem.mutate(
      {
        cycle_id: selectedCycle.id,
        name,
        price,
        // Stage 1: a building block. Hidden from the customer menu, and left
        // without a recipe so it is never treated as a composite.
        is_customer_visible: false,
      },
      { onSuccess: () => navigation.goBack() },
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
          Create Item
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

        <ThemedText variant="small" color="muted" style={styles.hint}>
          An item is a single thing the kitchen prepares — Idli, Vada, Chapati.
          It is priced here and stays off the customer menu; menu items are
          built from these on the next screen.
        </ThemedText>

        {/* Item name */}
        <TextInput
          style={styles.input}
          placeholder="Item name  (e.g. Idli)"
          placeholderTextColor={Theme.colors.text.muted}
          value={itemName}
          onChangeText={setItemName}
          returnKeyType="next"
        />

        {/* Item price */}
        <TextInput
          style={styles.input}
          placeholder="Price  (₹ per unit)"
          placeholderTextColor={Theme.colors.text.muted}
          value={itemPrice}
          onChangeText={setItemPrice}
          keyboardType="numeric"
          onSubmitEditing={handleSave}
          returnKeyType="done"
        />

        {/* Existing items in this cycle */}
        {existingItems.length > 0 && (
          <View style={styles.existingBlock}>
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
              ALREADY IN {selectedCycle?.cycle_name?.toUpperCase()}
            </ThemedText>
            {existingItems.map((it) => (
              <View key={it.id} style={styles.existingRow}>
                <ThemedText
                  variant="body"
                  color={it.is_active ? 'primary' : 'muted'}
                  style={[styles.txt, styles.flex1]}
                  numberOfLines={1}
                >
                  {it.name}
                </ThemedText>
                <ThemedText variant="body" color="subtitle" style={styles.txt}>
                  ₹{it.price > 0 ? it.price : '—'}
                </ThemedText>
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
          {addMenuItem.isPending ? 'Saving...' : 'Save Item  ›'}
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
    marginBottom: Theme.spacing.sm,
  },

  hint: { fontSize: S, marginBottom: Theme.spacing.md },

  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },

  existingBlock: { marginTop: Theme.spacing.lg },
  sectionLabel: { fontSize: S, letterSpacing: 1, marginBottom: Theme.spacing.xs },
  existingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  flex1: { flex: 1 },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },

  txt: { fontSize: B },
});
