/**
 * 1stOne F1 — Add Essential Item Screen
 *
 * Creates a new item in essentials_catalog linked to a delivery cycle (cycle_id).
 * Toggle shows Morning/Noon/Afternoon/Evening as friendly labels for
 * the underlying Breakfast/Lunch/Snacks/Dinner cycles.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Image,
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
  pickCatalogPhoto,
  uploadCatalogPhoto,
  type PickedPhoto,
} from '../../utils/catalogPhotoUpload';
import { PHOTO_BUCKET } from '../../utils/catalogPhoto';
import { useAddEssential } from '../../hooks/useEssentialsCatalog';
import { useAllDeliveryCycles } from '../../hooks/useMenuManagement';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;

export function CreateEssentialScreen({ navigation, route }: AdminScreenProps<'CreateEssential'>) {
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  // Essentials cycles only (is_essentials = true) — matches EssentialsCatalogManageScreen
  const cycles = useMemo(
    () => rawCycles.filter((c: any) => c.is_essentials),
    [rawCycles]
  );

  const addEssential = useAddEssential();
  const [cycleIdx, setCycleIdx] = useState(0);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  // Held locally until Save: the storage path is keyed by the row id, which
  // does not exist yet.
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [uploading, setUploading] = useState(false);

  const handlePickPhoto = async () => {
    const p = await pickCatalogPhoto();
    // null = permission refused or cancelled. Both are ordinary; keep any
    // photo already chosen rather than clearing it.
    if (p) setPhoto(p);
  };

  // Sync to cycle passed from parent screen
  useEffect(() => {
    if (!cycles.length) return;
    const paramId = route.params?.cycleId;
    if (!paramId) return;
    const idx = cycles.findIndex((c: any) => c.id === paramId);
    if (idx >= 0) setCycleIdx(idx);
  }, [cycles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCycle = cycles[cycleIdx] as any;
  const displayName = selectedCycle ? selectedCycle.cycle_name : '…';
  const cycleLabel = `${displayName} Essentials`;

  const handleCycleToggle = () => {
    if (!cycles.length) return;
    setCycleIdx((p) => (p + 1) % cycles.length);
  };

  const handleSave = () => {
    if (!name.trim()) { Alert.alert('Error', 'Enter an item name'); return; }
    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice < 0) { Alert.alert('Error', 'Enter a valid price'); return; }
    if (!selectedCycle) { Alert.alert('Error', 'No delivery cycles available'); return; }
    addEssential.mutate(
      {
        name: name.trim(),
        cycle_id: selectedCycle.id,
        price: numPrice,
        description: description.trim() || undefined,
      },
      {
        // The photo lives at a path keyed by the row id, so it can only be
        // uploaded once the insert has returned one. Two steps, one tap.
        onSuccess: async (created: any) => {
          const row = Array.isArray(created) ? created[0] : created;
          if (photo && row?.id) {
            setUploading(true);
            try {
              await uploadCatalogPhoto(PHOTO_BUCKET.essentials, row.id, photo);
            } catch (e) {
              // The item itself saved — say so, and say what did not, so the
              // admin retries the photo rather than creating a duplicate item.
              Alert.alert(
                'Item saved, photo failed',
                `${name.trim()} was created without its picture. Add it from Essentials Manager.\n\n${
                  e instanceof Error ? e.message : 'Unknown error'
                }`,
              );
            } finally {
              setUploading(false);
            }
          }
          navigation.goBack();
        },
      }
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Add Essential Item
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Cycle toggle */}
        <TouchableOpacity style={styles.cycleRow} onPress={handleCycleToggle} activeOpacity={0.7}>
          <ThemedText variant="body" color="mint" style={styles.txt}>
            {cycleLabel}{'  ›'}
          </ThemedText>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder="Item name  (e.g. Full Cream Milk)"
          placeholderTextColor={Theme.colors.text.muted}
          value={name}
          onChangeText={setName}
        />

        <TextInput
          style={styles.input}
          placeholder="Price  (₹)"
          placeholderTextColor={Theme.colors.text.muted}
          value={price}
          onChangeText={setPrice}
          keyboardType="numeric"
          returnKeyType="done"
        />

        {/* Description — the line under the name on the customer's Home
            screen. Optional; the row simply omits it when blank. */}
        <TextInput
          style={styles.input}
          placeholder="Description  (shown to customers, optional)"
          placeholderTextColor={Theme.colors.text.muted}
          value={description}
          onChangeText={setDescription}
          multiline
        />

        {/* Photo — picked now, uploaded after Save returns the row id. */}
        <View style={styles.photoRow}>
          <TouchableOpacity onPress={handlePickPhoto} activeOpacity={0.75}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.photoTile} resizeMode="cover" />
            ) : (
              <View style={[styles.photoTile, styles.photoEmpty]}>
                <ThemedText variant="small" color="muted">Add photo</ThemedText>
              </View>
            )}
          </TouchableOpacity>
          <View style={styles.photoMeta}>
            <TouchableOpacity onPress={handlePickPhoto} activeOpacity={0.7}>
              <ThemedText variant="body" color="mint" style={styles.txt}>
                {photo ? 'Change photo  ›' : 'Choose photo  ›'}
              </ThemedText>
            </TouchableOpacity>
            {photo ? (
              <TouchableOpacity onPress={() => setPhoto(null)} activeOpacity={0.7}>
                <ThemedText variant="small" color="muted" style={styles.photoRemove}>
                  Remove
                </ThemedText>
              </TouchableOpacity>
            ) : (
              <ThemedText variant="small" color="muted" style={styles.photoHint}>
                Square crop. Shown on the customer menu.
              </ThemedText>
            )}
          </View>
        </View>
      </ScrollView>

      <TouchableOpacity
        style={styles.footer}
        onPress={handleSave}
        disabled={addEssential.isPending || uploading}
        activeOpacity={0.7}
      >
        <ThemedText
          variant="body"
          color={addEssential.isPending || uploading ? 'muted' : 'mint'}
          style={styles.txt}
        >
          {uploading
            ? 'Uploading photo...'
            : addEssential.isPending
              ? 'Saving...'
              : 'Save Item  ›'}
        </ThemedText>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const S = Theme.typography.sizes.small + 2;

const styles = StyleSheet.create({
  // ── Photo picker ──
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  // Same 76pt tile the customer row uses, so what the admin approves here is
  // the size they will actually see.
  photoTile: {
    width: 76,
    height: 76,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.photoEdge,
    backgroundColor: Theme.colors.background.secondary,
  },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  photoMeta: { flex: 1, marginLeft: Theme.spacing.md },
  photoHint: { fontSize: S, marginTop: 4 },
  photoRemove: { fontSize: S, marginTop: 6 },

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
  scroll: { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },
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
    paddingVertical: Theme.spacing.sm + 2,
    marginBottom: Theme.spacing.sm,
  },
  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
  txt: { fontSize: B },
});
