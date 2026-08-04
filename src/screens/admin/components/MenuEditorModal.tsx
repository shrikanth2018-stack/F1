/**
 * 1stOne F1 — Menu editor (Step 2)
 *
 * A customer-facing dish: name, sub-text, photo, contents, price. Everything
 * about one menu in one place, instead of a list plus two screens plus inline
 * price editing.
 *
 * CONTENTS ARE PICKED, NEVER TYPED. The recipe text is what the kitchen board
 * parses, so a typo there is a prep line for an ingredient nobody stocks.
 * Parts come from Step 1 blocks, found by typing rather than by scrolling a
 * list of forty.
 *
 * A LINE IS A COUNT OF THE ITEM'S OWN PORTION — "Sambar 150 ml × 1", not
 * "Sambar 150 ml". The portion belongs to the item and is shown here as a
 * fact; the only thing typed is how many of them this dish contains. Checked
 * against the real menu before changing it: 70 of 77 recipe lines were exactly
 * one portion, so the old field was asking for a number the item already knew.
 * It also removes a duplicated fact that nothing kept in step — an item's
 * portion could be edited on the Menu Items tab while every recipe went on
 * saying the old amount.
 *
 * WHAT IS STORED DID NOT CHANGE. The recipe text is still an absolute amount
 * ("Sambar:150 ml"), so get_kitchen_aggregate, the prep board and the order
 * path are all untouched. The count is presentation: read as qty ÷ portion,
 * written back as count × portion.
 *
 * AND THE STORED AMOUNT IS NEVER REWRITTEN UNLESS THE BOX IS TYPED IN. Five
 * lines are not whole multiples — Masala Dosa takes 100 ml of a 150 ml sambar,
 * so its count is 0.667. Multiplying a rounded 0.667 back out gives 100.05,
 * which would corrupt the recipe on any save that merely opened the dish. So
 * `qty` stays exactly as parsed until someone edits that row's count.
 *
 * THE UNIT IS READ-ONLY HERE. It belongs to the item — Sambar is ml wherever
 * it appears — and is resolved from the block at save time rather than trusted
 * from the stored text, so a recipe cached before the item's unit changed
 * cannot write the old one back and split the ingredient into two prep lines.
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
  parseRecipe, buildRecipe, toMenuUnit, portionCount, countToQty,
  type RecipePart,
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
  /**
   * What each count box shows, once it has been typed in — keyed by row.
   *
   * A row absent from here renders its count derived from the stored amount,
   * which is what keeps an untouched 0.667 from being rounded and multiplied
   * back into 100.05. It also lets a half-typed "1." survive, the same reason
   * RecipePart.qty is a string.
   */
  const [countText, setCountText] = useState<Record<number, string>>({});
  const [find, setFind] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? '');
    setSubtext(item?.description ?? '');
    setPrice(item ? String(item.price) : '');
    setParts(parseRecipe(item?.ingredients));
    setCountText({});
    setFind('');
    setPhoto(null);
  }, [visible, item]);

  /**
   * What the parts would cost bought separately.
   *
   * An item's price is for its OWN quantity — Sambar is ₹20 for 150 ml — so a
   * recipe line asking for 150 ml costs ₹20, not ₹20 × 150. Multiplying by the
   * line quantity alone is what made this read ₹3,000 for a plate of idli.
   */
  const blockFor = (partName: string) => blocks.find((b) => b.name === partName);

  /**
   * How much one of the item is. Falls back to 1 for a name no block matches,
   * which degrades the row to the raw amount rather than hiding the line —
   * the same tolerance parseRecipe has, and for the same reason.
   */
  const portionOf = (partName: string) =>
    Number(blockFor(partName)?.base_quantity ?? 1) || 1;

  /** The item's own unit is the truth; the stored text is only a fallback. */
  const unitFor = (partName: string, fallback: string) =>
    toMenuUnit(blockFor(partName)?.unit ?? fallback);

  /** What the box shows: typed if it has been, derived from the amount if not. */
  const countFor = (p: RecipePart, i: number) =>
    countText[i] ?? String(portionCount(Number(p.qty), portionOf(p.name)));

  const partsTotal = useMemo(
    () => parts.reduce((sum, p) => {
      const b = blocks.find((x) => x.name === p.name);
      if (!b) return sum;
      const per = Number(b.base_quantity ?? 1) || 1;
      return sum + (b.price ?? 0) * ((Number(p.qty) || 0) / per);
    }, 0),
    [parts, blocks],
  );

  // Nothing until you type — the point of the box is to replace a 40-row
  // scroll. Names that START with what was typed come first, because that is
  // what someone typing "sa" for Sambar expects to see at the top.
  const matches = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q) return [];
    return blocks
      .filter((b) => b.is_active && !parts.some((p) => p.name === b.name))
      .filter((b) => b.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const sa = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const sb = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return sa - sb || a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }, [blocks, parts, find]);

  /**
   * Typing a count is the only thing that rewrites the stored amount. The text
   * is kept as typed so "1." survives mid-edit; the amount follows whenever it
   * parses to a real number.
   */
  const setCount = (i: number, text: string) => {
    setCountText((prev) => ({ ...prev, [i]: text }));
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) {
      setParts((prev) =>
        prev.map((p, x) =>
          x === i ? { ...p, qty: String(countToQty(n, portionOf(p.name))) } : p,
        ),
      );
    }
  };

  /** Removing a row shifts every later index, so the typed counts shift with it. */
  const removePart = (i: number) => {
    setParts((prev) => prev.filter((_, n) => n !== i));
    setCountText((prev) => {
      const next: Record<number, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        const n = Number(k);
        if (n < i) next[n] = v;
        else if (n > i) next[n - 1] = v;
      }
      return next;
    });
  };

  // A new part starts at one portion of itself — "Sambar 150 ml × 1".
  const addPart = (b: MenuItem) => {
    setParts((prev) => [
      ...prev,
      {
        name: b.name,
        qty: String(Number(b.base_quantity ?? 1) || 1),
        unit: toMenuUnit(b.unit),
      },
    ]);
    setFind('');
  };

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
    const recipe = buildRecipe(parts.map((p) => ({ ...p, unit: unitFor(p.name, p.unit) })));
    if (!recipe) {
      infoDialog('Quantities required', 'Every item needs a count greater than zero.');
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
            {/* Price sits beside the name because those two are what actually
                get changed; everything below is set once and left alone. */}
            <View style={s.nameRow}>
              <TextInput
                style={[s.input, s.flex1]}
                placeholder="Menu name  (e.g. Idli Vada)"
                placeholderTextColor={Theme.colors.text.muted}
                value={name}
                onChangeText={setName}
              />
              {/* Money is mint wherever it appears in the menu builder, and
                  the ₹ is a label rather than typed, so the field holds a
                  number and nothing else. */}
              <ThemedText variant="body" color="mint" style={s.rupee}>₹</ThemedText>
              <TextInput
                style={[s.input, s.priceBox]}
                placeholder="price"
                placeholderTextColor={Theme.colors.text.muted}
                value={price}
                onChangeText={setPrice}
                keyboardType="numeric"
              />
            </View>
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
                {/* The item's own portion, and not editable: it belongs to the
                    item, and is changed on the Menu Items tab so every menu
                    using it stays in step. */}
                <ThemedText variant="small" color="muted" style={s.portion}>
                  {`${portionOf(p.name)} ${unitFor(p.name, p.unit)}`}
                </ThemedText>
                <ThemedText variant="small" color="muted">×</ThemedText>
                <TextInput
                  style={s.qty}
                  value={countFor(p, i)}
                  onChangeText={(v) => setCount(i, v)}
                  keyboardType="numeric"
                  placeholder="1"
                  placeholderTextColor={Theme.colors.text.muted}
                />
                <TouchableOpacity
                  onPress={() => removePart(i)}
                  hitSlop={{ top: 8, bottom: 8, left: 10, right: 4 }}
                >
                  <ThemedText variant="body" color="muted" style={s.remove}>×</ThemedText>
                </TouchableOpacity>
              </View>
            ))}
            {parts.length === 0 && (
              <ThemedText variant="small" color="muted" style={s.hint}>
                Nothing yet — find its parts below.
              </ThemedText>
            )}

            <TextInput
              style={[s.input, s.findBox]}
              placeholder="Add an item — type a letter or two"
              placeholderTextColor={Theme.colors.text.muted}
              value={find}
              onChangeText={setFind}
              autoCorrect={false}
            />
            {find.trim().length > 0 && matches.length === 0 && (
              <ThemedText variant="small" color="muted" style={s.hint}>
                Nothing matches “{find.trim()}”. Create it on the Menu Items tab first.
              </ThemedText>
            )}
            {matches.map((b) => (
              <TouchableOpacity key={b.id} style={s.partRow} activeOpacity={0.7} onPress={() => addPart(b)}>
                <ThemedText variant="body" color="primary" style={[s.txt, s.flex1]} numberOfLines={1}>
                  {b.name}
                </ThemedText>
                {/* Its own portion, so the quantity you are about to type has
                    something to be relative to. Priced at ₹0 — which is every
                    part until one is sold on its own — the money is left off
                    rather than shown as a meaningless zero. */}
                <ThemedText variant="small" color={b.price > 0 ? 'mint' : 'muted'}>
                  {b.price > 0 ? `${formatPriceShort(b.price)} for ` : ''}
                  {Number(b.base_quantity ?? 1)} {toMenuUnit(b.unit)}
                </ThemedText>
                <ThemedText variant="body" color="mint" style={s.plus}>+</ThemedText>
              </TouchableOpacity>
            ))}

            {partsTotal > 0 && (
              <ThemedText variant="small" color="muted" style={s.hint}>
                Parts add up to{' '}
                <ThemedText variant="small" color="mint">{formatPriceShort(partsTotal)}</ThemedText>
                {' '}— for reference only. A menu is priced on its own, and item prices are
                what a bulk order pays for them separately.
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
  // Right-aligned so the portions form a column the eye can run down, however
  // long the item's name is.
  portion: { fontSize: S, textAlign: 'right' },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Theme.spacing.sm },
  findBox: { marginTop: Theme.spacing.md, borderBottomColor: Theme.colors.text.mint },
  // The row aligns to the top, so the ₹ carries the input's own padding to
  // land on the same line as the number it labels.
  rupee: { fontSize: B, paddingTop: Theme.spacing.sm },
  priceBox: { width: 74, textAlign: 'right', color: Theme.colors.text.mint },
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
