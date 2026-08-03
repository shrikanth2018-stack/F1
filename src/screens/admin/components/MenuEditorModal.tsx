/**
 * 1stOne F1 — Menu editor (Step 2)
 *
 * A customer-facing dish: name, sub-text, photo, contents, price. Everything
 * about one menu in one place, instead of a list plus two screens plus inline
 * price editing.
 *
 * CONTENTS ARE PICKED, NEVER TYPED. The recipe text is what the kitchen board
 * parses, so a typo there is a prep line for an ingredient nobody stocks.
 * Parts come from Step 1 blocks; the quantity is a number plus a unit from a
 * closed set, because the aggregate groups prep by (name, unit) and a free
 * unit would split one ingredient into two lines.
 *
 * THE PRICE IS NOT THE SUM OF THE PARTS. A combo is rarely what its pieces
 * cost, and block prices exist for a different purpose entirely — what a bulk
 * order pays when it buys the ingredient alone. The parts total is shown as a
 * reference and never pre-fills the field.
 *
 * THE PHOTO NEEDS THE ROW TO EXIST, because the storage key is the item id.
 * On a new menu it is held in state and uploaded once the insert returns an
 * id — the same two-step CreateEssentialScreen uses.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { View, Modal, Image, ScrollView, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { CatalogPhotoThumb } from '../../../components/CatalogPhotoThumb';
import { PHOTO_BUCKET, PHOTO_PX } from '../../../utils/catalogPhoto';
import {
  pickCatalogPhoto, uploadCatalogPhoto, type PickedPhoto,
} from '../../../utils/catalogPhotoUpload';
import { confirmDialog, infoDialog } from '../../../utils/confirmDialog';
import { getErrorMessage, formatPriceShort } from '../../../utils/formatters';
import {
  parseRecipe, buildRecipe, MENU_UNITS, type RecipePart, type MenuUnit,
} from '../../../utils/menuRecipe';
import {
  useAddMenuItem, useUpdateMenuItem, useRemoveMenuItem, useMenuBlocks,
} from '../../../hooks/useMenuManagement';
import type { MenuItem } from '../../../types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

interface Props {
  visible: boolean;
  /** null = creating. */
  item: MenuItem | null;
  cycleId?: number;
  cycleName?: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

export function MenuEditorModal({ visible, item, cycleId, cycleName, onClose, onChanged }: Props) {
  const isNew = !item;
  const { data: blocks = [] } = useMenuBlocks();
  const add = useAddMenuItem();
  const update = useUpdateMenuItem();
  const remove = useRemoveMenuItem();

  const [name, setName] = useState('');
  const [subtext, setSubtext] = useState('');
  const [price, setPrice] = useState('');
  const [parts, setParts] = useState<RecipePart[]>([]);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? '');
    setSubtext(item?.description ?? '');
    setPrice(item ? String(item.price) : '');
    setParts(parseRecipe(item?.ingredients));
    setPhoto(null);
  }, [visible, item]);

  const partsTotal = useMemo(
    () => parts.reduce((sum, p) => {
      const b = blocks.find((x) => x.name === p.name);
      return sum + (b?.price ?? 0) * (Number(p.qty) || 0);
    }, 0),
    [parts, blocks],
  );

  const available = useMemo(
    () => blocks.filter((b) => b.is_active && !parts.some((p) => p.name === b.name)),
    [blocks, parts],
  );

  const setPart = (i: number, patch: Partial<RecipePart>) =>
    setParts((prev) => prev.map((p, n) => (n === i ? { ...p, ...patch } : p)));

  const handlePhoto = async () => {
    setPicking(true);
    try {
      const p = await pickCatalogPhoto();
      if (!p) return;
      if (isNew) {
        setPhoto(p);                                   // held until the row exists
      } else {
        await uploadCatalogPhoto(PHOTO_BUCKET.menu, item!.id, p);
        await onChanged();
      }
    } catch (e) {
      infoDialog('Could not set the photo', getErrorMessage(e));
    } finally {
      setPicking(false);
    }
  };

  const handleSave = async () => {
    const nm = name.trim();
    if (!nm) { infoDialog('Name required', 'What is this menu called?'); return; }
    if (nm.includes(':') || nm.includes(';')) {
      infoDialog('Invalid character', 'A name cannot contain ":" or ";" — they separate the parts of a recipe.');
      return;
    }
    if (parts.length === 0) {
      infoDialog('Add its contents', 'A menu is built from one or more items. Add at least one below.');
      return;
    }
    const recipe = buildRecipe(parts);
    if (!recipe) {
      infoDialog('Quantities required', 'Every item needs a quantity greater than zero.');
      return;
    }
    const p = parseFloat(price);
    if (!Number.isFinite(p) || p <= 0) {
      infoDialog('Price required', 'Enter what a customer pays for this menu.');
      return;
    }

    setBusy(true);
    try {
      if (isNew) {
        if (!cycleId) { infoDialog('No delivery time', 'No cycles available.'); return; }
        const created = await add.mutateAsync({
          cycle_id: cycleId,
          name: nm,
          price: p,
          ingredients: recipe,
          is_customer_visible: true,
          description: subtext.trim() || undefined,
        });
        const row = Array.isArray(created) ? created[0] : created;
        if (photo && row?.id) {
          try {
            await uploadCatalogPhoto(PHOTO_BUCKET.menu, row.id, photo);
          } catch (e) {
            // The menu saved; only the picture did not. Say which, so nobody
            // creates the menu a second time trying to fix it.
            await infoDialog(
              'Menu saved, photo failed',
              `${nm} was created without its picture. Add it by opening the menu again.\n\n${getErrorMessage(e)}`,
            );
          }
        }
      } else {
        await update.mutateAsync({
          id: item!.id,
          name: nm,
          price: p,
          ingredients: recipe,
          description: subtext.trim() || null,
        } as never);
      }
      await onChanged();
      onClose();
    } catch (e) {
      infoDialog('Could not save', getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!item) return;
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
      await onChanged();
      onClose();
      if (outcome === 'retired') {
        infoDialog('Retired', `${item.name} has been ordered before, so it is switched off rather than deleted.`);
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
      await onChanged();
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
              {isNew ? `New menu${cycleName ? ` · ${cycleName}` : ''}` : 'Edit menu'}
            </ThemedText>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <ThemedText variant="body" color="muted" style={s.close}>×</ThemedText>
            </TouchableOpacity>
          </View>

          <ScrollView style={s.body} keyboardShouldPersistTaps="handled">
            <TextInput
              style={s.input}
              placeholder="Menu name  (e.g. Idli Vada)"
              placeholderTextColor={Theme.colors.text.muted}
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={s.input}
              placeholder="Sub text  (shown under the name to customers)"
              placeholderTextColor={Theme.colors.text.muted}
              value={subtext}
              onChangeText={setSubtext}
              multiline
            />

            {/* Photo */}
            <View style={s.photoRow}>
              <TouchableOpacity onPress={handlePhoto} disabled={picking} activeOpacity={0.75}>
                {photo ? (
                  <Image source={{ uri: photo.uri }} style={s.tile} resizeMode="cover" />
                ) : item ? (
                  <CatalogPhotoThumb
                    bucket={PHOTO_BUCKET.menu}
                    item={item}
                    size={76}
                    requestPx={PHOTO_PX.row}
                    fallbackIcon="camera-outline"
                  />
                ) : (
                  <View style={[s.tile, s.tileEmpty]}>
                    <ThemedText variant="small" color="muted">Add photo</ThemedText>
                  </View>
                )}
              </TouchableOpacity>
              <View style={s.photoMeta}>
                <TouchableOpacity onPress={handlePhoto} disabled={picking} activeOpacity={0.7}>
                  <ThemedText variant="body" color="mint" style={s.txt}>
                    {picking ? 'Opening…' : photo || item?.image_path ? 'Change photo  ›' : 'Choose photo  ›'}
                  </ThemedText>
                </TouchableOpacity>
                <ThemedText variant="small" color="muted" style={s.hint}>
                  Square crop. This is what customers see.
                </ThemedText>
              </View>
            </View>

            {/* Contents */}
            <ThemedText variant="small" color="muted" style={s.section}>THIS MENU CONTAINS</ThemedText>
            {parts.map((p, i) => (
              <View key={`${p.name}-${i}`} style={s.partRow}>
                <ThemedText variant="body" color="primary" style={[s.txt, s.flex1]} numberOfLines={1}>
                  {p.name}
                </ThemedText>
                <TextInput
                  style={s.qty}
                  value={p.qty}
                  onChangeText={(v) => setPart(i, { qty: v })}
                  keyboardType="numeric"
                  placeholder="Qty"
                  placeholderTextColor={Theme.colors.text.muted}
                />
                {/* Tap to cycle the unit — a closed set, so a picker would be
                    four taps to do what one does. */}
                <TouchableOpacity
                  onPress={() => {
                    const idx = MENU_UNITS.findIndex((u) => u.key === p.unit);
                    setPart(i, { unit: MENU_UNITS[(idx + 1) % MENU_UNITS.length].key as MenuUnit });
                  }}
                  style={s.unitBtn}
                  activeOpacity={0.7}
                >
                  <ThemedText variant="small" color="mint">{p.unit}</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setParts((prev) => prev.filter((_, n) => n !== i))}
                  hitSlop={{ top: 8, bottom: 8, left: 10, right: 4 }}
                >
                  <ThemedText variant="body" color="muted" style={s.remove}>×</ThemedText>
                </TouchableOpacity>
              </View>
            ))}

            <ThemedText variant="small" color="muted" style={s.section}>ADD FROM ITEMS</ThemedText>
            {available.length === 0 ? (
              <ThemedText variant="small" color="muted" style={s.hint}>
                {parts.length > 0 ? 'Everything has been added.' : 'No items yet — create them on the Menu Items tab.'}
              </ThemedText>
            ) : (
              available.slice(0, 40).map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={s.partRow}
                  activeOpacity={0.7}
                  onPress={() => setParts((prev) => [...prev, { name: b.name, qty: '1', unit: 'no' }])}
                >
                  <ThemedText variant="body" color="primary" style={[s.txt, s.flex1]} numberOfLines={1}>
                    {b.name}
                  </ThemedText>
                  <ThemedText variant="body" color="subtitle" style={s.txt}>₹{b.price}</ThemedText>
                  <ThemedText variant="body" color="mint" style={s.plus}>+</ThemedText>
                </TouchableOpacity>
              ))
            )}

            {/* Price */}
            <ThemedText variant="small" color="muted" style={s.section}>PRICE</ThemedText>
            <TextInput
              style={s.input}
              placeholder="What a customer pays  (₹)"
              placeholderTextColor={Theme.colors.text.muted}
              value={price}
              onChangeText={setPrice}
              keyboardType="numeric"
            />
            {partsTotal > 0 && (
              <ThemedText variant="small" color="muted" style={s.hint}>
                Parts add up to {formatPriceShort(partsTotal)} — for reference only. A menu is
                priced on its own, and item prices are what a bulk order pays for them separately.
              </ThemedText>
            )}
          </ScrollView>

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
    maxHeight: '90%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { fontSize: B + 8, lineHeight: B + 10 },
  body: { marginTop: Theme.spacing.sm },
  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', marginVertical: Theme.spacing.sm },
  tile: {
    width: 76, height: 76,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1, borderColor: Theme.colors.layout.photoEdge,
    backgroundColor: Theme.colors.background.tertiary,
  },
  tileEmpty: { alignItems: 'center', justifyContent: 'center' },
  photoMeta: { flex: 1, marginLeft: Theme.spacing.md },
  hint: { fontSize: S, marginTop: 4 },
  section: { fontSize: S, letterSpacing: 1, marginTop: Theme.spacing.md, marginBottom: 2 },
  partRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    gap: Theme.spacing.sm,
  },
  flex1: { flex: 1 },
  qty: {
    width: 56, textAlign: 'center',
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: 2,
  },
  unitBtn: {
    minWidth: 46, alignItems: 'center',
    paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Theme.colors.text.mint,
  },
  remove: { fontSize: B + 4, color: Theme.colors.text.muted },
  plus: { fontSize: B + 4 },
  actions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: Theme.spacing.md, paddingTop: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Theme.colors.layout.divider,
  },
  right: { flexDirection: 'row', alignItems: 'center' },
  gap: { marginRight: Theme.spacing.lg },
  txt: { fontSize: B },
});
