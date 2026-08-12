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
 *
 * THE PRICE IS FOR A STATED QUANTITY — ₹20 for 150 ml, the two fields side by
 * side because neither means anything alone. That is what a bulk order pays
 * for ONE of these, so a line of ×2 is 300 ml at ₹40. It is NOT the quantity
 * in a recipe line: "Sambar:150 ml" says what that dish contains, a different
 * question, and this is the one number here that cascades nowhere.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { View, Modal, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { confirmDialog, infoDialog } from '../../../utils/confirmDialog';
import { getErrorMessage, formatPriceShort } from '../../../utils/formatters';
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
  const [baseQty, setBaseQty] = useState('1');
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
    setBaseQty(String(item?.base_quantity ?? 1));
    setUnit(toMenuUnit(item?.unit));
  }, [visible, item]);

  /**
   * The line under the two fields, in the terms the price is actually used in.
   * "₹20 for 150 ml" is abstract until it is spent — a bulk order of 2 is what
   * makes a wrong quantity obvious before it is saved rather than after it is
   * invoiced.
   */
  const costLine = useMemo(() => {
    const p = parseFloat(price);
    const q = parseFloat(baseQty);
    if (!Number.isFinite(q) || q <= 0) {
      return 'What a bulk order pays when it buys this on its own.';
    }
    const two = Number((q * 2).toFixed(3));
    if (!Number.isFinite(p) || p <= 0) {
      return `One is ${q} ${unit}. Price it only if it will be sold on its own.`;
    }
    return `A bulk order of 2 gets ${two} ${unit} and pays ${formatPriceShort(p * 2)}.`;
  }, [price, baseQty, unit]);

  const handleSave = async () => {
    const nm = name.trim();
    if (!nm) { infoDialog('Name required', 'What is this item called?'); return; }
    if (nm.includes(':') || nm.includes(';')) {
      infoDialog('Invalid character', 'A name cannot contain ":" or ";" — they separate the parts of a recipe.');
      return;
    }
    const p = parseFloat(price);
    const finalPrice = Number.isFinite(p) && p >= 0 ? p : 0;

    // A price of ₹20 "for 0" would be a division by zero everywhere it is
    // read, and the DB refuses it outright — so it is caught here, where the
    // message can say which field is wrong.
    const q = parseFloat(baseQty);
    if (!Number.isFinite(q) || q <= 0) {
      infoDialog('Quantity required', `How much is one ${nm}? Enter the ${unit} that the price buys.`);
      return;
    }

    setBusy(true);
    try {
      if (isNew) {
        await create.mutateAsync({ name: nm, price: finalPrice, unit, baseQty: q });
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
        // One update for the two plain columns — they are read together and
        // are meaningless apart, so they should not be able to half-save.
        const patch: Record<string, number> = {};
        if (finalPrice !== item!.price) patch.price = finalPrice;
        if (q !== (item!.base_quantity ?? 1)) patch.base_quantity = q;
        if (Object.keys(patch).length > 0) {
          await update.mutateAsync({ id: item!.id, ...patch } as never);
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

  /**
   * Disabling a block does far less than it looks like it does, and the gap
   * between the two is the problem.
   *
   * It does NOT take the item out of any recipe. Every menu using it keeps
   * selling, and the kitchen keeps prepping it, because the prep board is
   * built from the recipe TEXT. What it actually stops is the two places the
   * row itself is read: a bulk order can no longer buy it on its own
   * (orderBuild refuses an inactive item), and it stops being offered when
   * composing a new menu.
   *
   * Remove already refuses outright while a block is in use. Disable was
   * silent — so an admin switching Sambar off to take it off the menu got no
   * hint that nothing about the menu had changed. Now it says so, once, and
   * only when there is something to say.
   */
  const handleToggle = async () => {
    if (!item) return;
    if (item.is_active && usedIn > 0) {
      const ok = await confirmDialog({
        title: `Disable ${item.name}?`,
        message:
          `${item.name} is in ${usedIn} menu${usedIn === 1 ? '' : 's'}, and disabling it does not change ` +
          `${usedIn === 1 ? 'that menu' : 'those menus'} — ${usedIn === 1 ? 'it keeps' : 'they keep'} selling and the kitchen still preps it.\n\n` +
          'It only stops this item being sold on its own in a bulk order, and stops it being added to new menus.',
        confirmLabel: 'Disable',
        cancelLabel: 'Cancel',
      });
      if (!ok) return;
    }
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

          {/* Cost and quantity read as one sentence — "₹20 for 150 ml" — and
              sit below the unit because the unit is the word this line ends
              in. The money is mint, the only colour money wears here. */}
          <ThemedText variant="small" color="muted" style={s.label}>WHAT IT COSTS</ThemedText>
          <View style={s.costRow}>
            <ThemedText variant="body" color="mint" style={s.fixed}>₹</ThemedText>
            <TextInput
              style={[s.input, s.money]}
              placeholder="0"
              placeholderTextColor={Theme.colors.text.muted}
              value={price}
              onChangeText={setPrice}
              keyboardType="numeric"
            />
            <ThemedText variant="body" color="muted" style={s.fixed}>for</ThemedText>
            <TextInput
              style={[s.input, s.qtyBox]}
              placeholder="1"
              placeholderTextColor={Theme.colors.text.muted}
              value={baseQty}
              onChangeText={setBaseQty}
              keyboardType="numeric"
            />
            <ThemedText variant="body" color="muted" style={s.fixed}>{unit}</ThemedText>
          </View>
          <ThemedText variant="small" color="muted" style={s.usage}>
            {costLine}
          </ThemedText>

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
    flex: 1, backgroundColor: Theme.colors.layout.scrim,
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
  costRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  // The static words carry the input's own top margin so "₹", "for" and the
  // unit sit on the same line as what they describe.
  fixed: { fontSize: B, marginTop: Theme.spacing.sm },
  money: { flex: 1, color: Theme.colors.text.mint },
  qtyBox: { width: 72, textAlign: 'center' },
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
