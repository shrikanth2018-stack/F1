/**
 * 1stOne F1 — Add a listing (vendor)
 *
 * One item, start to finish, in one place: delivery time, name, price, unit,
 * daily cap and the photo. It replaces an inline form that sat under the item
 * list, where the photo could only be attached AFTER saving — the vendor had
 * to add the item, find it in the list, tap its tile, and only then send it.
 *
 * THE PHOTO IS PICKED BEFORE THE ROW EXISTS, which is why it is held in state
 * rather than uploaded on pick: the storage key is the item id
 * (`essentials-photos/{id}.jpg`), so there is nothing to key it to until the
 * insert returns. Save creates the row, then uploads. Same two-step
 * CreateEssentialScreen uses for the same reason.
 *
 * TWO WAYS OUT, because adding stock is usually a batch job:
 *   "+ Add More"  saves this one and clears the form, staying open
 *   "Submit"      saves this one and sends everything added here for approval
 *
 * A photo is required by both. `vendor_submit_listings` refuses an item
 * without one and names it, so letting a vendor save half a listing here only
 * moves the refusal somewhere less helpful.
 *
 * The footnote names the areas the vendor actually sells into. An approved
 * vendor with no granted zone reaches nobody and looks identical to one
 * selling normally, so the moment they are about to add stock is exactly when
 * that needs saying.
 */

import React, { useState } from 'react';
import {
  View,
  Modal,
  Image,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { PHOTO_BUCKET } from '../../../utils/catalogPhoto';
import {
  pickCatalogPhoto,
  uploadCatalogPhoto,
  type PickedPhoto,
} from '../../../utils/catalogPhotoUpload';
import { infoDialog } from '../../../utils/confirmDialog';
import { getErrorMessage } from '../../../utils/formatters';
import { essentialsCycleLabel } from '../../../utils/cycleLabels';
import { useCreateDraftListing, useSubmitListings } from '../../../hooks/useMyVendor';
import type { DeliveryCycle } from '../../../types';

/** Why an item the vendor already had was not part of this submission. */
function reasonNotSent(item: { image_path?: string | null; listing_status?: string | null }): string {
  if (!item.image_path) return 'still needs a photo';
  if (item.listing_status === 'rejected') return 'was sent back and needs a change first';
  return 'was not added in this session';
}

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Essentials cycles only — anything else is dropped by the customer page. */
  cycles: DeliveryCycle[];
  /** Names of the zones/hubs this vendor was granted. */
  areaNames: string[];
  /** Called after anything is created, so the list behind refreshes. */
  onChanged: () => Promise<void> | void;
  /**
   * Drafts and sent-back items the vendor already had. Submit does NOT send
   * these — only what was added in this sitting — so they are named on the way
   * out with the reason. Leaving them out silently is how a vendor ends up
   * believing everything went in.
   */
  otherUnsent: {
    id: number;
    name: string;
    image_path?: string | null;
    listing_status?: string | null;
  }[];
}

export function AddListingModal({
  visible,
  onClose,
  cycles,
  areaNames,
  onChanged,
  otherUnsent,
}: Props) {
  const createDraft = useCreateDraftListing();
  const submitListings = useSubmitListings();

  const [cycleIdx, setCycleIdx] = useState(0);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('');
  const [cap, setCap] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  // Ids created in THIS sitting. Submit sends these, not every draft the
  // vendor happens to have — a rejected item they have not fixed yet should
  // not ride along silently.
  const [addedIds, setAddedIds] = useState<number[]>([]);

  const selectedCycle = cycles[cycleIdx];

  const reset = () => {
    setName(''); setPrice(''); setUnit(''); setCap(''); setPhoto(null);
  };

  const closeAll = () => {
    reset();
    setAddedIds([]);
    onClose();
  };

  const handlePickPhoto = async () => {
    try {
      const p = await pickCatalogPhoto();
      // null = cancelled or permission refused. Keep any photo already chosen.
      if (p) setPhoto(p);
    } catch (e) {
      infoDialog('Cannot use that picture', getErrorMessage(e));
    }
  };

  /** Validate + create the row + attach the photo. Returns the new id. */
  const saveCurrent = async (): Promise<number | null> => {
    if (!name.trim()) { infoDialog('Name required', 'What is this item called?'); return null; }
    const p = parseFloat(price);
    if (!Number.isFinite(p) || p <= 0) { infoDialog('Price required', 'Enter the selling price.'); return null; }
    if (!selectedCycle) { infoDialog('No delivery time', 'No delivery times are available.'); return null; }
    if (!photo) {
      infoDialog('Photo required', 'Every listing needs a photo before it can go for approval.');
      return null;
    }

    setBusy(true);
    try {
      const id = await createDraft.mutateAsync({
        name: name.trim(),
        price: p,
        unit: unit.trim() || 'unit',
        cycleId: selectedCycle.id,
        dailyCap: cap.trim() ? parseInt(cap, 10) : null,
      });
      await uploadCatalogPhoto(PHOTO_BUCKET.essentials, id, photo);
      await onChanged();
      setAddedIds((prev) => [...prev, id]);
      return id;
    } catch (e) {
      infoDialog('Could not save', getErrorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleAddMore = async () => {
    const id = await saveCurrent();
    if (id != null) reset();
  };

  const handleSubmit = async () => {
    const id = await saveCurrent();
    if (id == null) return;

    const ids = [...addedIds, id];
    setBusy(true);
    try {
      const n = await submitListings.mutateAsync(ids);
      await onChanged();
      closeAll();

      // Anything the vendor already had that did NOT go, and why. Without
      // this they close the dialog believing the whole shelf is with us.
      const leftBehind = otherUnsent
        .filter((i) => !ids.includes(i.id))
        .map((i) => `${i.name} — ${reasonNotSent(i)}`);

      infoDialog(
        'Sent for approval',
        `${n} ${n === 1 ? 'item is' : 'items are'} with the team. They appear for customers once approved.` +
          (leftBehind.length
            ? `\n\nNot sent:\n${leftBehind.join('\n')}\n\nFix these on the list, then use "Send for approval" there.`
            : ''),
      );
    } catch (e) {
      infoDialog('Could not send', getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={closeAll}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.head}>
            <ThemedText variant="subtitle" color="primary">Add an item</ThemedText>
            <TouchableOpacity onPress={closeAll} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <ThemedText variant="body" color="muted" style={s.close}>×</ThemedText>
            </TouchableOpacity>
          </View>

          {addedIds.length > 0 ? (
            <ThemedText variant="small" color="mint" style={s.queued}>
              {addedIds.length} added — Submit sends {addedIds.length === 1 ? 'it' : 'them all'}.
            </ThemedText>
          ) : null}

          <ScrollView keyboardShouldPersistTaps="handled" style={s.body}>
            {/* Delivery time — tap to cycle, same as everywhere else here. */}
            <TouchableOpacity
              style={s.cycleRow}
              onPress={() => setCycleIdx((p) => (cycles.length ? (p + 1) % cycles.length : 0))}
              activeOpacity={0.7}
            >
              <ThemedText variant="body" color="mint" style={s.txt}>
                {selectedCycle ? essentialsCycleLabel(selectedCycle) : 'Loading…'}{'  ›'}
              </ThemedText>
            </TouchableOpacity>

            <TextInput
              style={s.input}
              placeholder="Item name"
              placeholderTextColor={Theme.colors.text.muted}
              value={name}
              onChangeText={setName}
            />
            <View style={s.row2}>
              <TextInput
                style={[s.input, s.flex1]}
                placeholder="Price ₹"
                placeholderTextColor={Theme.colors.text.muted}
                value={price}
                onChangeText={setPrice}
                keyboardType="numeric"
              />
              <TextInput
                style={[s.input, s.flex1]}
                placeholder="Unit (kg, litre)"
                placeholderTextColor={Theme.colors.text.muted}
                value={unit}
                onChangeText={setUnit}
              />
            </View>
            <TextInput
              style={s.input}
              placeholder="Max per day (optional)"
              placeholderTextColor={Theme.colors.text.muted}
              value={cap}
              onChangeText={setCap}
              keyboardType="numeric"
            />

            {/* Photo, in the same pass — no going back to the list for it. */}
            <View style={s.photoRow}>
              <TouchableOpacity onPress={handlePickPhoto} activeOpacity={0.75}>
                {photo ? (
                  <Image source={{ uri: photo.uri }} style={s.photoTile} resizeMode="cover" />
                ) : (
                  <View style={[s.photoTile, s.photoEmpty]}>
                    <ThemedText variant="small" color="muted">Add photo</ThemedText>
                  </View>
                )}
              </TouchableOpacity>
              <View style={s.photoMeta}>
                <TouchableOpacity onPress={handlePickPhoto} activeOpacity={0.7}>
                  <ThemedText variant="body" color="mint" style={s.txt}>
                    {photo ? 'Change photo  ›' : 'Choose photo  ›'}
                  </ThemedText>
                </TouchableOpacity>
                <ThemedText variant="small" color="muted" style={s.photoHint}>
                  Required. Square crop — this is what customers see.
                </ThemedText>
              </View>
            </View>

            {/* Where this actually ends up. An approved vendor with no granted
                area reaches nobody and looks exactly like one selling fine. */}
            {areaNames.length > 0 ? (
              <ThemedText variant="small" color="muted" style={s.footnote}>
                Once approved, this will be listed to customers in {areaNames.join(', ')}.
              </ThemedText>
            ) : (
              <ThemedText variant="small" color="warning" style={s.footnote}>
                You have no delivery areas yet, so this will not reach any customer even
                once approved. Please get in touch and we will switch them on.
              </ThemedText>
            )}
          </ScrollView>

          <View style={s.actions}>
            <TouchableOpacity onPress={handleSubmit} disabled={busy} activeOpacity={0.7}>
              {busy ? (
                <ActivityIndicator size="small" color={Theme.colors.text.mint} />
              ) : (
                <ThemedText variant="body" color="mint" style={s.txt}>Submit for approval  ›</ThemedText>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleAddMore} disabled={busy} activeOpacity={0.7}>
              <ThemedText variant="body" color={busy ? 'muted' : 'subtitle'} style={s.txt}>+ Add More</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Theme.colors.layout.scrim,
    justifyContent: 'center',
    padding: Theme.spacing.md,
  },
  sheet: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    maxHeight: '88%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { fontSize: B + 8, lineHeight: B + 10 },
  queued: { marginTop: 2 },
  body: { marginTop: Theme.spacing.sm },

  cycleRow: {
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    alignSelf: 'flex-start',
    marginBottom: Theme.spacing.sm,
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
  row2: { flexDirection: 'row', gap: Theme.spacing.sm },
  flex1: { flex: 1 },

  photoRow: { flexDirection: 'row', alignItems: 'center', marginTop: Theme.spacing.sm },
  photoTile: {
    width: 76,
    height: 76,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.photoEdge,
    backgroundColor: Theme.colors.background.tertiary,
  },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  photoMeta: { flex: 1, marginLeft: Theme.spacing.md },
  photoHint: { fontSize: S, marginTop: 4 },

  footnote: {
    fontSize: S,
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.xs,
  },

  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  txt: { fontSize: B },
});
