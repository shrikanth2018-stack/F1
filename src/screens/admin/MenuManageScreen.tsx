/**
 * 1stOne F1 — Menu Manager
 *
 * The menu is built in two steps, and this screen is now one tab per step
 * rather than both mixed into a single list. Menus lead, because that is the
 * day-to-day work — items are the parts drawer behind them.
 *
 *   Menus       what customers buy, per delivery cycle. Composed from Menu
 *               Items, never hand-typed, with a photo and a sub-text.
 *
 *   Menu Items  the building blocks — Idli, Sambar, Chutney. Priced, because
 *               a bulk order can buy one on its own, and each carries the unit
 *               it is measured in. No cycle: an ingredient is not a mealtime.
 *               No photo: a customer never sees one.
 *
 * The cycle switcher belongs to Menus alone — Menu Items have no cycle, so
 * offering one there would imply a filter that does not exist.
 *
 * EVERY EDIT IS A POPUP. The old screen edited the price inline and committed
 * on blur, so tapping elsewhere saved silently; and adding anything meant
 * leaving for one of two separate screens. Both are gone — one row, one tap,
 * one dialog with an explicit Save.
 */

import React, { useState, useMemo } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../../utils/constants';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import { SegmentedControl } from '../../components/SegmentedControl';
import { CatalogPhotoThumb } from '../../components/CatalogPhotoThumb';
import { PHOTO_BUCKET, PHOTO_PX } from '../../utils/catalogPhoto';
import { summariseRecipe, toMenuUnit } from '../../utils/menuRecipe';
import { formatPriceShort } from '../../utils/formatters';
import { MenuItemEditorModal } from './components/MenuItemEditorModal';
import { MenuEditorModal } from './components/MenuEditorModal';
import { useMenuBlocks, useMenusForCycle, useAllDeliveryCycles } from '../../hooks/useMenuManagement';
import type { MenuItem } from '../../types';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;
const THUMB = 48;

type Tab = 'items' | 'menus';

export function MenuManageScreen({ navigation }: { navigation: AdminNavProp }) {
  const [tab, setTab] = useState<Tab>('menus');
  const [cycleIdx, setCycleIdx] = useState(0);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [editMenu, setEditMenu] = useState<MenuItem | null>(null);
  const [openItemModal, setOpenItemModal] = useState(false);
  const [openMenuModal, setOpenMenuModal] = useState(false);

  const queryClient = useQueryClient();
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  const cycles = useMemo(() => rawCycles.filter((c: any) => c.is_active), [rawCycles]);
  const selected = cycles[cycleIdx] ?? cycles[0];

  const blocks = useMenuBlocks();
  const menus = useMenusForCycle(selected?.id);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['menu_blocks'] });
    await queryClient.invalidateQueries({ queryKey: ['menus_for_cycle'] });
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MENU_ITEMS });
  };

  const closeItem = async () => { setOpenItemModal(false); setEditItem(null); await refresh(); };
  const closeMenu = async () => { setOpenMenuModal(false); setEditMenu(null); await refresh(); };

  // ── Rows ────────────────────────────────────────────────────

  const renderBlock = ({ item }: { item: MenuItem }) => (
    <TouchableOpacity
      style={[styles.row, !item.is_active && styles.dim]}
      activeOpacity={0.6}
      onPress={() => { setEditItem(item); setOpenItemModal(true); }}
    >
      <View style={styles.flex1}>
        <ThemedText variant="body" color="primary" style={styles.txt} numberOfLines={1}>
          {item.name}
        </ThemedText>
        <ThemedText variant="small" color="muted" style={styles.sub}>
          {item.price > 0 ? formatPriceShort(item.price) : 'No price set'}
          {` · measured in ${toMenuUnit(item.unit)}`}
          {!item.is_active ? ' · disabled' : ''}
        </ThemedText>
      </View>
      <ThemedText variant="body" color="muted" style={styles.txt}>›</ThemedText>
    </TouchableOpacity>
  );

  const renderMenu = ({ item }: { item: MenuItem }) => (
    <TouchableOpacity
      style={[styles.row, !item.is_active && styles.dim]}
      activeOpacity={0.6}
      onPress={() => { setEditMenu(item); setOpenMenuModal(true); }}
    >
      <CatalogPhotoThumb
        bucket={PHOTO_BUCKET.menu}
        item={item}
        size={THUMB}
        requestPx={PHOTO_PX.admin}
        fallbackIcon="camera-outline"
      />
      <View style={[styles.flex1, styles.menuMeta]}>
        <ThemedText variant="body" color="primary" style={styles.txt} numberOfLines={1}>
          {item.name}
        </ThemedText>
        {/* Names only. Quantities are the editor's job — a list is for finding
            the right row, not for reading a recipe. */}
        <ThemedText variant="small" color="muted" style={styles.sub} numberOfLines={1}>
          {summariseRecipe(item.ingredients) || 'No contents yet'}
        </ThemedText>
        <ThemedText variant="small" color="mint" style={styles.sub}>
          {formatPriceShort(item.price)}{!item.is_active ? ' · disabled' : ''}
        </ThemedText>
      </View>
      <ThemedText variant="body" color="muted" style={styles.txt}>›</ThemedText>
    </TouchableOpacity>
  );

  const isItems = tab === 'items';
  const data = (isItems ? blocks.data : menus.data) ?? [];
  const loading = isItems ? blocks.isLoading : menus.isLoading;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Menu Manager</ThemedText>
        <View style={styles.spacer} />
      </View>

      <SegmentedControl<Tab>
        style={styles.tabs}
        value={tab}
        onChange={setTab}
        options={[
          { key: 'menus', label: 'Menus' },
          { key: 'items', label: 'Menu Items' },
        ]}
      />

      {/* Cycle applies to Menus only — Menu Items have none. */}
      {!isItems && cycles.length > 0 && (
        <TouchableOpacity
          style={styles.cycleRow}
          onPress={() => setCycleIdx((p) => (p + 1) % cycles.length)}
          activeOpacity={0.7}
        >
          <ThemedText variant="body" color="mint" style={styles.txt}>
            {selected ? `${selected.cycle_name} Menu` : 'Loading…'}{'  ›'}
          </ThemedText>
        </TouchableOpacity>
      )}

      {isItems && (
        <ThemedText variant="small" color="muted" style={styles.lede}>
          The parts a menu is built from. Each carries its unit and a price for when a
          bulk order buys it on its own.
        </ThemedText>
      )}

      <FlatList
        data={data}
        keyExtractor={(i) => String(i.id)}
        renderItem={isItems ? renderBlock : renderMenu}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              title={isItems ? 'No items yet' : `No menus for ${selected?.cycle_name ?? 'this cycle'}`}
              subtitle={isItems ? 'Add the parts first — Idli, Sambar, Chutney' : 'Tap "+ New menu" below'}
            />
          ) : null
        }
      />

      <View style={styles.footer}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ImportItems', { type: 'menu' })}
        >
          <ThemedText variant="body" color="muted" style={styles.txt}>Import CSV{'  ›'}</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            if (isItems) { setEditItem(null); setOpenItemModal(true); }
            else { setEditMenu(null); setOpenMenuModal(true); }
          }}
        >
          <ThemedText variant="body" color="mint" style={styles.txt}>
            {isItems ? '+ New item' : '+ New menu'}{'  ›'}
          </ThemedText>
        </TouchableOpacity>
      </View>

      <MenuItemEditorModal visible={openItemModal} item={editItem} onClose={closeItem} />
      <MenuEditorModal
        visible={openMenuModal}
        item={editMenu}
        cycleId={selected?.id}
        cycleName={selected?.cycle_name}
        onClose={closeMenu}
        onChanged={refresh}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.layout.divider,
  },
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },
  tabs: { marginHorizontal: Theme.spacing.md, marginVertical: Theme.spacing.sm },
  cycleRow: {
    paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.text.mint,
    alignSelf: 'flex-start', marginLeft: Theme.spacing.md,
  },
  lede: {
    fontSize: S,
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },
  list: { paddingBottom: Theme.spacing.xl },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Theme.colors.layout.divider,
    gap: Theme.spacing.md,
  },
  dim: { opacity: 0.45 },
  flex1: { flex: 1 },
  menuMeta: { marginLeft: 0 },
  txt: { fontSize: B },
  sub: { fontSize: S, marginTop: 2 },
  footer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Theme.colors.text.mint,
  },
});
