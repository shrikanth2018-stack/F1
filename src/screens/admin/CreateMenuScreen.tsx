/**
 * 1stOne F1 — Create Menu Item (stage 2 of the menu builder)
 *
 * Stage 1 (CreateItemScreen) defines priced ITEMS — the building blocks
 * (Idli ₹12, Vada ₹25), hidden from the customer menu. This screen clubs
 * them into a customer-facing MENU ITEM ("Idli Vada") that carries its OWN
 * combination price — a combo is rarely the sum of its parts, so the price
 * is entered here rather than derived.
 *
 * Storage: one menu_items row, is_customer_visible = true, with the recipe
 * in `ingredients` as "Idli:2;Vada:1". That text grammar is exactly what
 * get_kitchen_aggregate parses, so the kitchen explodes this menu item into
 * its components and merges them with the same item ordered on its own —
 * one correct prep line either way.
 *
 * Only component-less items of the SAME cycle can be added: the kitchen
 * aggregation explodes one level only, so a menu item may not contain
 * another menu item.
 *
 * Cycle toggle: tap the title text to cycle through Breakfast → Lunch → …
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

/** A building-block item chosen for this menu item, with its quantity. */
type PickedItem = { id: number; name: string; price: number; qty: string };

export function CreateMenuScreen({ navigation, route }: AdminScreenProps<'CreateMenu'>) {
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  // Active delivery cycles (already branch-scoped & sort_order-ordered by
  // useAllDeliveryCycles). Filter on is_active, not a cycle-name substring —
  // renaming a cycle must never drop it from the picker.
  const cycles = rawCycles.filter((c: any) => c.is_active);
  const addMenuItem = useAddMenuItem();

  const [cycleIdx, setCycleIdx] = useState(0);
  const [menuName, setMenuName] = useState('');
  const [menuPrice, setMenuPrice] = useState('');
  const [picked, setPicked] = useState<PickedItem[]>([]);

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

  const { data: allInCycle = [] } = useAllMenuItems(selectedCycle?.id);

  // Selectable building blocks: this cycle's active, admin-only items that
  // are not themselves composites (no nesting — see the header note).
  const availableItems = useMemo(
    () =>
      (allInCycle as MenuItem[]).filter(
        (m) =>
          m.is_active &&
          m.is_customer_visible === false &&
          !(m.ingredients && m.ingredients.trim()) &&
          !picked.some((p) => p.id === m.id),
      ),
    [allInCycle, picked],
  );

  // Sum of the parts — shown as a reference next to the combination price.
  const partsTotal = useMemo(
    () => picked.reduce((sum, p) => sum + p.price * (parseInt(p.qty, 10) || 0), 0),
    [picked],
  );

  const handleCycleToggle = () => {
    if (!cycles.length) return;
    // Items belong to a cycle, so switching cycles invalidates the selection.
    setCycleIdx((p) => (p + 1) % cycles.length);
    setPicked([]);
  };

  const handleAdd = (item: MenuItem) => {
    setPicked((prev) => [
      ...prev,
      { id: item.id, name: item.name, price: item.price, qty: '1' },
    ]);
  };

  const handleQty = (id: number, qty: string) => {
    setPicked((prev) => prev.map((p) => (p.id === id ? { ...p, qty } : p)));
  };

  const handleRemove = (id: number) => {
    setPicked((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSave = () => {
    const name = menuName.trim();
    if (!name) {
      infoDialog('Name required', 'Enter the menu item name.');
      return;
    }
    if (name.includes(':') || name.includes(';')) {
      infoDialog(
        'Invalid character',
        'Menu item names cannot contain ":" or ";" — they separate the parts of a recipe.',
      );
      return;
    }
    if (!selectedCycle) {
      infoDialog('No cycle', 'No delivery cycles available.');
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
    const badQty = picked.find((p) => !(parseInt(p.qty, 10) > 0));
    if (badQty) {
      infoDialog('Quantity required', `Set how many ${badQty.name} go into this menu item.`);
      return;
    }

    const price = parseFloat(menuPrice);
    // Price may be left blank and set later from Menu Manager — but never
    // negative, and never silently NaN.
    const finalPrice = Number.isFinite(price) && price >= 0 ? price : 0;

    // "Idli:2;Vada:1" — the grammar get_kitchen_aggregate parses. Names come
    // straight from the selected rows, so they always match exactly.
    const recipe = picked.map((p) => `${p.name}:${parseInt(p.qty, 10)}`).join(';');

    addMenuItem.mutate(
      {
        cycle_id: selectedCycle.id,
        name,
        price: finalPrice,
        ingredients: recipe || undefined,
        // Stage 2 always produces a customer-facing row.
        is_customer_visible: true,
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
          placeholder="Menu item name  (e.g. Idli Vada)"
          placeholderTextColor={Theme.colors.text.muted}
          value={menuName}
          onChangeText={setMenuName}
          returnKeyType="next"
        />

        {/* Combination price */}
        <TextInput
          style={styles.input}
          placeholder="Price on the customer menu  (₹)"
          placeholderTextColor={Theme.colors.text.muted}
          value={menuPrice}
          onChangeText={setMenuPrice}
          keyboardType="numeric"
          returnKeyType="done"
        />
        {picked.length > 0 && (
          <ThemedText variant="small" color="muted" style={styles.hint}>
            Parts add up to ₹{partsTotal} — the menu price is set independently.
          </ThemedText>
        )}

        {/* Chosen parts */}
        {picked.length > 0 && (
          <View style={styles.block}>
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
              THIS MENU ITEM CONTAINS
            </ThemedText>
            {picked.map((p) => (
              <View key={p.id} style={styles.row}>
                <ThemedText
                  variant="body"
                  color="primary"
                  style={[styles.txt, styles.flex1]}
                  numberOfLines={1}
                >
                  {p.name}
                </ThemedText>
                <TextInput
                  style={styles.qtyInput}
                  value={p.qty}
                  onChangeText={(v) => handleQty(p.id, v)}
                  keyboardType="numeric"
                  placeholder="Qty"
                  placeholderTextColor={Theme.colors.text.muted}
                />
                <TouchableOpacity
                  onPress={() => handleRemove(p.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 12, right: 4 }}
                >
                  <ThemedText variant="body" color="muted" style={styles.removeX}>×</ThemedText>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Available building blocks */}
        <View style={styles.block}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            ADD FROM ITEMS
          </ThemedText>
          {availableItems.length === 0 ? (
            <ThemedText variant="small" color="muted" style={styles.hint}>
              {picked.length > 0
                ? 'All items in this cycle have been added.'
                : 'No items yet in this cycle. Create them first from Menu Manager → + Item.'}
            </ThemedText>
          ) : (
            availableItems.map((it) => (
              <TouchableOpacity
                key={it.id}
                style={styles.row}
                onPress={() => handleAdd(it)}
                activeOpacity={0.7}
              >
                <ThemedText
                  variant="body"
                  color="primary"
                  style={[styles.txt, styles.flex1]}
                  numberOfLines={1}
                >
                  {it.name}
                </ThemedText>
                <ThemedText variant="body" color="subtitle" style={styles.txt}>
                  ₹{it.price}
                </ThemedText>
                <ThemedText variant="body" color="mint" style={styles.plus}>+</ThemedText>
              </TouchableOpacity>
            ))
          )}
        </View>
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

  hint: { fontSize: S, marginTop: 2 },

  block: { marginTop: Theme.spacing.lg },
  sectionLabel: { fontSize: S, letterSpacing: 1, marginBottom: Theme.spacing.xs },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  flex1: { flex: 1 },
  qtyInput: {
    width: 64,
    textAlign: 'center',
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: 2,
  },
  removeX: {
    fontSize: B + 4,
    marginLeft: Theme.spacing.sm,
    color: Theme.colors.text.muted,
  },
  plus: { fontSize: B + 4, marginLeft: Theme.spacing.md },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },

  txt: { fontSize: B },
});
