/**
 * 1stOne F1 — Menu Item editor (Step 1)
 *
 * A building block: a priced ingredient with no cycle and no picture. Its
 * price is used when a bulk order pulls the item on its own — a customer
 * never sees one.
 *
 * TWO THINGS HERE ARE NOT WHAT THEY LOOK LIKE.
 *
 * A RENAME IS NOT A FIELD EDIT. Recipes name blocks as text, so changing the
 * name has to rewrite every recipe using it. That runs server-side through
 * `admin_rename_menu_block`, which compares each recipe's name part exactly —
 * a string replace would corrupt the eight names that contain another block's
 * name ('Rice' is inside Curd Rice, Fried Rice, Rice Pullav and two more).
 * The usage count is shown before you commit, so it is never a blind change.
 *
 * REMOVE IS NOT ALWAYS A DELETE. The server deletes an item that was never
 * ordered and retires one that was, because order history references it. The
 * button says which it will do, from the same count.
 *
 * THE UNIT LIVES HERE, not on each menu. Sambar is measured in ml — always,
 * in every dish that uses it — so it belongs to Sambar. Changing it is a
 * third cascade: the unit sits in the recipe text too, and the kitchen groups
 * prep by (name, unit), so the two must move together or one ingredient
 * becomes two prep lines. It is internal: a customer sees the quantity of the
 * menu they bought, never of an ingredient inside it.
 */

import React, { useState, useEffect } from 'react';
import { View, Modal, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { confirmDialog, infoDialog } from '../../../utils/confirmDialog';
import { getErrorMessage } from '../../../utils/formatters';
import {
  useCreateMenuBlock,
  useRenameMenuBlock,
  useUpdateMenuItem,
  useRemoveMenuItem,
  useSetMenuBlockUnit,
  useBlockUsage,
} from '../../../hooks/useMenuManagement';
import { MENU_UNITS, DEFAULT_UNIT, toMenuUnit, type MenuUnit } from '../../../utils/menuRecipe';
import type { MenuItem } from '../../../types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

interface Props {
  visible: boolean;
  /** null = creating a new block. */
  item: MenuItem | null;
  onClose: () => void;
}

export function MenuItemEditorModal({ visible, item, onClose }: Props) {
  const isNew = !item;
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState<MenuUnit>(DEFAULT_UNIT);
  const [busy, setBusy] = useState(false);

  const create = useCreateMenuBlock();
  const rename = useRenameMenuBlock();
  const update = useUpdateMenuItem();
  const remove = useRemoveMenuItem();
  const setBlockUnit = useSetMenuBlockUnit();
  const { data: usedIn = 0 } = useBlockUsage(item?.name);

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? '');
    setPrice(item ? String(item.price) : '');
    setUnit(toMenuUnit(item?.unit));
  }, [visible, item]);

  const handleSave = async () => {
    const nm = name.trim();
    if (!nm) { infoDialog('Name required', 'What is this item called?'); return; }
    if (nm.includes(':') || nm.includes(';')) {
      infoDialog('Invalid character', 'A name cannot contain ":" or ";" — they separate the parts of a recipe.');
      return;
    }
    const p = parseFloat(price);
    const finalPrice = Number.isFinite(p) && p >= 0 ? p : 0;

    setBusy(true);
    try {
      if (isNew) {
        await create.mutateAsync({ name: nm, price: finalPrice, unit });
      } else {
        // Name and price move through different paths on purpose: the price is
        // a column, the name is a cascade.
        if (nm !== item!.name) {
          // The RPC returns how many recipes it rewrote; the shared mutation
          // helper types its result loosely, hence the narrowing.
          const res = await rename.mutateAsync({ oldName: item!.name, newName: nm });
          const changed = Array.isArray(res) ? Number(res[0] ?? 0) : Number(res ?? 0);
          if (changed > 0) {
            infoDialog('Renamed', `${changed} menu${changed === 1 ? '' : 's'} updated to use "${nm}".`);
          }
        }
        if (finalPrice !== item!.price) {
          await update.mutateAsync({ id: item!.id, price: finalPrice });
        }
        // Last, and through its own RPC: this rewrites recipes, so it must not
        // run before the rename has settled the names it matches on.
        if (unit !== toMenuUnit(item!.unit)) {
          await setBlockUnit.mutateAsync({ id: item!.id, unit });
        }
      }
      onClose();
    } catch (e) {
      infoDialog('Could not save', getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!item) return;
    if (usedIn > 0) {
      infoDialog(
        'Still in use',
        `${item.name} is used by ${usedIn} menu${usedIn === 1 ? '' : 's'}. Take it out of those first.`,
      );
      return;
    }
    const ok = await confirmDialog({
      title: `Remove ${item.name}?`,
      message: 'If it has ever been ordered it is retired rather than deleted, so past orders still read correctly.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const outcome = await remove.mutateAsync({ id: item.id });
      onClose();
      if (outcome === 'retired') {
        infoDialog('Retired', `${item.name} has been ordered before, so it is switched off rather than deleted — past orders still show it.`);
      }
    } catch (e) {
      infoDialog('Could not remove', getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await update.mutateAsync({ id: item.id, is_active: !item.is_active });
      onClose();
    } catch (e) {
      infoDialog('Could not change', getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.head}>
            <ThemedText variant="subtitle" color="primary">
              {isNew ? 'New item' : 'Edit item'}
            </ThemedText>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <ThemedText variant="body" color="muted" style={s.close}>×</ThemedText>
            </TouchableOpacity>
          </View>

          <TextInput
            style={s.input}
            placeholder="Name  (e.g. Sambar)"
            placeholderTextColor={Theme.colors.text.muted}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={s.input}
            placeholder="Price ₹  (used when a bulk order buys it alone)"
            placeholderTextColor={Theme.colors.text.muted}
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
          />

          <ThemedText variant="small" color="muted" style={s.label}>MEASURED IN</ThemedText>
          <View style={s.units}>
            {MENU_UNITS.map((u) => {
              const on = u === unit;
              return (
                <TouchableOpacity
                  key={u}
                  onPress={() => setUnit(u)}
                  style={[s.unit, on && s.unitOn]}
                  activeOpacity={0.7}
                >
                  <ThemedText variant="small" color={on ? 'mint' : 'muted'}>{u}</ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
          {!isNew && usedIn > 0 && unit !== toMenuUnit(item!.unit) && (
            <ThemedText variant="small" color="warning" style={s.usage}>
              This rewrites the quantity in {usedIn} menu{usedIn === 1 ? '' : 's'} — check them after saving.
            </ThemedText>
          )}

          {/* Where this block actually shows up. Renaming or removing without
              knowing this is how a recipe quietly loses an ingredient. */}
          {!isNew && (
            <ThemedText variant="small" color={usedIn > 0 ? 'mint' : 'muted'} style={s.usage}>
              {usedIn > 0
                ? `Used by ${usedIn} menu${usedIn === 1 ? '' : 's'} — a rename updates them all`
                : 'Not used by any menu yet'}
            </ThemedText>
          )}

          <View style={s.actions}>
            {!isNew ? (
              <TouchableOpacity onPress={handleRemove} disabled={busy}>
                <ThemedText variant="body" color="warning" style={s.txt}>Remove</ThemedText>
              </TouchableOpacity>
            ) : <View />}

            <View style={s.right}>
              {!isNew && (
                <TouchableOpacity onPress={handleToggle} disabled={busy} style={s.gap}>
                  <ThemedText variant="body" color="subtitle" style={s.txt}>
                    {item!.is_active ? 'Disable' : 'Enable'}
                  </ThemedText>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={handleSave} disabled={busy}>
                <ThemedText variant="body" color="mint" style={s.txt}>
                  {busy ? 'Saving…' : 'Save  ›'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', padding: Theme.spacing.md,
  },
  sheet: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { fontSize: B + 8, lineHeight: B + 10 },
  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm,
    marginTop: Theme.spacing.sm,
  },
  usage: { fontSize: S, marginTop: Theme.spacing.sm },
  label: { fontSize: S, letterSpacing: 1, marginTop: Theme.spacing.md },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.sm, marginTop: Theme.spacing.sm },
  unit: {
    paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Theme.colors.layout.divider,
  },
  unitOn: { borderColor: Theme.colors.text.mint },
  actions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: Theme.spacing.lg, paddingTop: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Theme.colors.layout.divider,
  },
  right: { flexDirection: 'row', alignItems: 'center' },
  gap: { marginRight: Theme.spacing.lg },
  txt: { fontSize: B },
});
