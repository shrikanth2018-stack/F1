/**
 * 1stOne F1 — Menu Manager
 *
 * Lists menus per cycle (toggle tap cycles through Breakfast → Lunch → …).
 * Each row: menu name | tap-to-edit price | enable/disable switch.
 * Footer: "+ Item" → CreateItemScreen · "+ Menu item" → CreateMenuScreen.
 *
 * Shows BOTH stages of the builder: the priced building-block items
 * (is_customer_visible = false) and the customer-facing menu items composed
 * from them. Items are listed here deliberately — this is where their price
 * is edited after creation. A row with components under its name is a menu
 * item; a row without is an item.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../../utils/constants';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import { CatalogPhotoThumb } from '../../components/CatalogPhotoThumb';
import { PHOTO_BUCKET, PHOTO_PX } from '../../utils/catalogPhoto';
import {
  pickCatalogPhoto,
  uploadCatalogPhoto,
  removeCatalogPhoto,
} from '../../utils/catalogPhotoUpload';
import {
  useAllMenuItems,
  useUpdateMenuItem,
  useToggleMenuItem,
  useAllDeliveryCycles,
} from '../../hooks/useMenuManagement';
import type { MenuItem } from '../../types';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;
const P = Theme.typography.sizes.body + 4;   // price text
const THUMB = 48;                            // admin row tile, points

/**
 * Parse a menu item's components from `ingredients`.
 *
 * Two formats coexist. The two-stage builder writes the "Name:qty;Name:qty"
 * grammar that get_kitchen_aggregate parses; menus created before it hold a
 * JSON array. Both are rendered so no existing row goes blank.
 */
function parseComponents(raw?: string | null): { name: string; qty: string }[] {
  const text = raw?.trim();
  if (!text) return [];

  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* not valid JSON after all — fall through to the text grammar */
    }
  }

  return text
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [name, qty] = chunk.split(':');
      return { name: (name ?? '').trim(), qty: (qty ?? '').trim() };
    })
    .filter((c) => c.name.length > 0);
}

export function MenuManageScreen({ navigation }: { navigation: AdminNavProp }) {
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  // Active delivery cycles (already branch-scoped & sort_order-ordered by
  // useAllDeliveryCycles). Filter on is_active, not a cycle-name substring —
  // renaming a cycle must never drop it from the picker.
  const cycleOptions = useMemo(
    () => rawCycles.filter((c: any) => c.is_active),
    [rawCycles]
  );
  const [cycleIdx, setCycleIdx] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [busyPhotoId, setBusyPhotoId] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const updateItem = useUpdateMenuItem();
  const toggleItem = useToggleMenuItem();

  const selected = cycleOptions[cycleIdx] ?? cycleOptions[0];
  const { data: items = [], isLoading } = useAllMenuItems(selected?.id);

  const cycleLabel = selected ? `${selected.cycle_name} Menu` : 'Loading…';

  const handleCycleToggle = () => {
    setCycleIdx((p) => (p + 1) % cycleOptions.length);
  };

  const handlePriceTap = (item: MenuItem) => {
    setEditingId(item.id);
    setPriceInput(String(item.price));
  };

  const commitPrice = (id: number) => {
    const price = parseFloat(priceInput);
    if (!isNaN(price) && price >= 0) {
      updateItem.mutate({ id, price });
    }
    setEditingId(null);
  };

  /**
   * Set or replace a row's photo.
   *
   * The upload overwrites the object at `menu-photos/{id}.jpg`, so there is
   * never a second picture to clean up. React Query invalidation is what
   * refreshes the tile — image_updated_at changes, which changes the ?v= on
   * the URL, which is what gets past the CDN.
   */
  const handlePhoto = async (item: MenuItem) => {
    const photo = await pickCatalogPhoto();
    if (!photo) return;
    setBusyPhotoId(item.id);
    try {
      await uploadCatalogPhoto(PHOTO_BUCKET.menu, item.id, photo);
      await queryClient.invalidateQueries({ queryKey: ['admin_menu_items'] });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MENU_ITEMS });
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyPhotoId(null);
    }
  };

  const confirmRemovePhoto = (item: MenuItem) => {
    Alert.alert(
      'Remove photo?',
      `${item.name} will show the default icon on the customer menu.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusyPhotoId(item.id);
            try {
              await removeCatalogPhoto(PHOTO_BUCKET.menu, item.id);
              await queryClient.invalidateQueries({ queryKey: ['admin_menu_items'] });
              await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MENU_ITEMS });
            } catch (e) {
              Alert.alert('Could not remove', e instanceof Error ? e.message : 'Unknown error');
            } finally {
              setBusyPhotoId(null);
            }
          },
        },
      ],
    );
  };

  const handleToggle = (id: number, current: boolean) => {
    if (current) {
      Alert.alert(
        'Disable Menu Item?',
        'This item will no longer appear on the customer menu.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Disable', style: 'destructive', onPress: () => toggleItem.mutate({ id, is_active: false }) },
        ]
      );
    } else {
      toggleItem.mutate({ id, is_active: true });
    }
  };

  const renderItem = ({ item }: { item: MenuItem }) => {
    const components = parseComponents(item.ingredients);
    const isEditingPrice = editingId === item.id;

    return (
      <View style={[styles.row, !item.is_active && styles.rowDim]}>
        {/* Photo tile — customer-facing MENU ITEMS only. This list also holds
            stage-1 building blocks (is_customer_visible = false), which never
            reach the customer menu, so a picture on one would be effort that
            nobody ever sees. Tap to set or replace, long-press to remove. */}
        {item.is_customer_visible && (
          <TouchableOpacity
            onPress={() => handlePhoto(item)}
            onLongPress={() => item.image_path && confirmRemovePhoto(item)}
            disabled={busyPhotoId === item.id}
            activeOpacity={0.7}
            style={[styles.thumbWrap, busyPhotoId === item.id && styles.thumbBusy]}
          >
            <CatalogPhotoThumb
              bucket={PHOTO_BUCKET.menu}
              item={item}
              size={THUMB}
              requestPx={PHOTO_PX.admin}
              fallbackIcon="camera-outline"
            />
          </TouchableOpacity>
        )}

        <View style={styles.rowLeft}>
          <ThemedText variant="body" color="primary" style={styles.rowText} numberOfLines={1}>
            {item.name}
          </ThemedText>

          {components.length > 0 && (
            <ThemedText variant="small" color="muted" style={styles.components} numberOfLines={1}>
              {components.map((c) => `${c.name}${c.qty ? ` ×${c.qty}` : ''}`).join('  ·  ')}
            </ThemedText>
          )}

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
                ₹{item.price > 0 ? item.price : '—'}{'  ✎'}
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>

        <Switch
          value={item.is_active}
          onValueChange={() => handleToggle(item.id, item.is_active)}
          trackColor={{
            true: Theme.colors.status.success,
            false: Theme.colors.background.tertiary,
          }}
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
          Menu Manager
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      {/* Cycle toggle — tap the text to cycle */}
      <TouchableOpacity style={styles.cycleRow} onPress={handleCycleToggle} activeOpacity={0.7}>
        <ThemedText variant="body" color="mint" style={styles.cycleText}>
          {cycleLabel}{'  ›'}
        </ThemedText>
      </TouchableOpacity>

      {/* Menu list */}
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState title="No menus for this cycle" subtitle={'Tap "+ Item" below to start'} />
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
          onPress={() => navigation.navigate('ImportItems', { type: 'menu' })}
        >
          <ThemedText variant="body" color="muted" style={styles.rowText}>
            Import CSV{'  ›'}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('CreateItem', {
              cycleId: selected?.id,
              cycleName: selected?.cycle_name,
            })
          }
        >
          <ThemedText variant="body" color="mint" style={styles.rowText}>
            + Item{'  ›'}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('CreateMenu', {
              cycleId: selected?.id,
              cycleName: selected?.cycle_name,
            })
          }
        >
          <ThemedText variant="body" color="mint" style={styles.rowText}>
            + Menu item{'  ›'}
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
  thumbWrap: { marginRight: Theme.spacing.md },
  thumbBusy: { opacity: 0.4 },
  rowLeft: { flex: 1, marginRight: Theme.spacing.sm },
  rowText: { fontSize: B },
  components: { fontSize: S, marginTop: 2 },
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
