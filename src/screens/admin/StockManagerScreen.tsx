/**
 * 1stOne F1 — Stock Manager (Admin) — BF-17 Solution D
 *
 * 2 tabs:
 *   Current Order — unified view of all items waiting to be ordered
 *                   (staff submissions arrive auto-mirrored from
 *                   staff_order_requests_mirror trigger; admin's Add Item
 *                   inserts directly). Edit qty, remove, Print All footer.
 *   History       — past print batches; reprint option.
 *
 * The previous 3-tab Pending → Approve → Active model was retired:
 * staff submissions are auto-approved-on-insert and appear in the unified
 * list immediately. Admin's edit-in-place IS the approval. Print finalizes.
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
  Text,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import {
  useActiveOrderList,
  useAdminAddOrderItem,
  useUpdateOrderItemQty,
  useRemoveOrderItem,
  usePrintBatch,
  useSupplyBatches,
  useSupplyCatalog,
  buildOrderListHTML,
} from '../../hooks/useStockManager';
import type { SupplyOrderItem } from '../../types';
import type { AdminNavProp } from '../../navigation/types';

type StockTab = 'Current Order' | 'History';
type Category = 'Vegetables' | 'Grocery' | 'Stationery';

const CATEGORIES: Category[] = ['Vegetables', 'Grocery', 'Stationery'];

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

// ── Current Order Tab ────────────────────────────────────
// (Previously "Order List" — renamed to reflect BF-17's unified
// model. Function name kept as OrderListTab to minimise diff; tab
// label is "Current Order".)

function OrderListTab({
  onPrint,
  onPrintAll,
}: {
  onPrint: (category: Category) => void;
  onPrintAll: () => void;
}) {
  const { data: items = [], isLoading, refetch } = useActiveOrderList();
  const updateQty = useUpdateOrderItemQty();
  const remove = useRemoveOrderItem();
  const addItem = useAdminAddOrderItem();

  const [addName, setAddName] = useState('');
  const [addCat, setAddCat] = useState<Category>('Vegetables');
  const [showAddForm, setShowAddForm] = useState(false);
  const [adjustingCategory, setAdjustingCategory] = useState<Category | null>(null);
  const [adjustPct, setAdjustPct] = useState('');

  const handleApplyAdjust = (cat: Category) => {
    const pct = parseFloat(adjustPct);
    if (!isFinite(pct) || pct === 0) {
      Alert.alert('Invalid', 'Enter a non-zero percentage (e.g. -20 to reduce, +10 to increase).');
      return;
    }
    if (pct < -90) {
      Alert.alert('Too aggressive', 'Reductions below -90% are not allowed.');
      return;
    }
    const catItems = items.filter((i) => i.category === cat);
    if (catItems.length === 0) return;

    const factor = 1 + pct / 100;
    Alert.alert(
      `Adjust ${cat}?`,
      `Apply ${pct > 0 ? '+' : ''}${pct}% to ${catItems.length} item${catItems.length !== 1 ? 's' : ''} in ${cat}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          onPress: () => {
            for (const item of catItems) {
              const next = Math.max(1, Math.round(item.qty * factor));
              if (next !== item.qty) {
                updateQty.mutate({ id: item.id, qty: next });
              }
            }
            setAdjustingCategory(null);
            setAdjustPct('');
          },
        },
      ],
    );
  };

  // BF-17 polish: staff-style add. Picking a suggestion (or the
  // custom row) inserts with qty=1; admin uses ± inline to adjust.
  // Form stays open so admin can add multiple items in a row.
  const handlePick = (rawName: string) => {
    const name = rawName.trim();
    if (!name) { Alert.alert('Name required'); return; }
    addItem.mutate(
      { name, qty: 1, category: addCat },
      {
        onSuccess: () => { setAddName(''); },
        onError: (e: any) => Alert.alert('Error', e.message),
      },
    );
  };

  const handleRemove = (item: SupplyOrderItem) => {
    Alert.alert('Remove', `Remove "${item.name}" from the order list?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => remove.mutate(item.id, { onError: (e: any) => Alert.alert('Error', e.message) }),
      },
    ]);
  };

  const changeQty = (item: SupplyOrderItem, delta: number) => {
    const next = Math.max(1, item.qty + delta);
    updateQty.mutate({ id: item.id, qty: next });
  };

  const grouped = CATEGORIES.map((cat) => ({
    cat,
    items: items.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <ScrollView
        style={styles.tabContent}
        contentContainerStyle={styles.listPad}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Theme.colors.action.primary} />
        }
      >
        {items.length === 0 && !isLoading && (
          <ThemedText variant="body" color="muted" style={[styles.emptyText, { marginTop: Theme.spacing.lg }]}>
            No items yet.{'\n'}Add items below — staff submissions appear here automatically.
          </ThemedText>
        )}

        {grouped.map(({ cat, items: catItems }) => (
          <View key={cat}>
            <View style={styles.sectionHeader}>
              <ThemedText variant="small" color="muted" style={{ fontSize: S, letterSpacing: 1, flex: 1 }}>
                {cat.toUpperCase()}
              </ThemedText>
              <TouchableOpacity
                onPress={() => onPrint(cat)}
                style={{ marginRight: Theme.spacing.md }}
              >
                <ThemedText variant="small" color="mint" style={{ fontSize: S }}>Print ›</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => {
                setAdjustingCategory(adjustingCategory === cat ? null : cat);
                setAdjustPct('');
              }}>
                <ThemedText variant="small" color="accent" style={{ fontSize: S }}>
                  {adjustingCategory === cat ? 'Cancel' : 'Adjust by %'}
                </ThemedText>
              </TouchableOpacity>
            </View>
            {adjustingCategory === cat && (
              <View style={styles.adjustRow}>
                <TextInput
                  value={adjustPct}
                  onChangeText={setAdjustPct}
                  placeholder="-20 to reduce, +10 to increase"
                  placeholderTextColor={Theme.colors.text.muted}
                  keyboardType="numbers-and-punctuation"
                  style={styles.adjustInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity onPress={() => handleApplyAdjust(cat)}>
                  <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Apply ›</ThemedText>
                </TouchableOpacity>
              </View>
            )}
            {catItems.map((item) => (
              <View key={item.id} style={styles.orderItemRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                    {item.name}
                  </ThemedText>
                  {item.request_id === null && (
                    <ThemedText variant="small" color="accent" style={{ fontSize: S - 1 }}>
                      Admin added
                    </ThemedText>
                  )}
                </View>
                {/* Qty controls */}
                <TouchableOpacity onPress={() => changeQty(item, -1)} style={styles.qtyBtn}>
                  <Text style={styles.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qtyNum}>{item.qty}</Text>
                <TouchableOpacity onPress={() => changeQty(item, +1)} style={styles.qtyBtn}>
                  <Text style={styles.qtyBtnText}>+</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRemove(item)} style={styles.removeBtn}>
                  <Text style={styles.removeText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
            <Divider />
          </View>
        ))}
      </ScrollView>

      {/* Add Item form — outside ScrollView so the items list scrolls
          independently above it; form stays visible while adding.
          BF-17: Print moved to per-category section header (above);
          footer is just "+ Add Item". */}
      {showAddForm && (
        <AddItemForm
          addCat={addCat}
          setAddCat={setAddCat}
          addName={addName}
          setAddName={setAddName}
          isPending={addItem.isPending}
          onPick={handlePick}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {!showAddForm && (
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => setShowAddForm(true)}>
            <ThemedText variant="body" color="accent" style={{ fontSize: B }}>+ Add Item</ThemedText>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {items.length > 0 && (
            <TouchableOpacity onPress={onPrintAll}>
              <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Print All ›</ThemedText>
            </TouchableOpacity>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ── History Tab ──────────────────────────────────────────

function HistoryTab() {
  const { data: batches = [], isLoading, refetch } = useSupplyBatches();

  const handleReprint = async (batch: any) => {
    const html = buildOrderListHTML(batch.items_snapshot, batch.printed_at);
    try {
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { UTI: 'com.adobe.pdf', mimeType: 'application/pdf' });
    } catch {
      Alert.alert('Error', 'Could not generate PDF.');
    }
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Theme.colors.action.primary} />
      </View>
    );
  }

  if (batches.length === 0) {
    return (
      <View style={styles.center}>
        <ThemedText variant="body" color="muted" style={styles.emptyText}>
          No print history yet
        </ThemedText>
      </View>
    );
  }

  return (
    <FlatList
      data={batches}
      keyExtractor={(b) => String(b.id)}
      contentContainerStyle={styles.listPad}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Theme.colors.action.primary} />
      }
      renderItem={({ item: batch }) => {
        const total = (batch.items_snapshot as any[]).reduce((s: number, i: any) => s + i.qty, 0);
        const cats = [...new Set((batch.items_snapshot as any[]).map((i: any) => i.category))].join(', ');
        return (
          <View style={styles.batchCard}>
            <View style={styles.batchHeader}>
              <View>
                <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                  {new Date(batch.printed_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </ThemedText>
                <ThemedText variant="small" color="muted" style={{ fontSize: S }}>
                  {new Date(batch.printed_at).toLocaleTimeString('en-IN', {
                    hour: '2-digit', minute: '2-digit',
                  })}  ·  {(batch.items_snapshot as any[]).length} items  ·  {total} units
                </ThemedText>
                <ThemedText variant="small" color="muted" style={{ fontSize: S }}>
                  {cats}
                </ThemedText>
              </View>
              <TouchableOpacity onPress={() => handleReprint(batch)}>
                <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Reprint ›</ThemedText>
              </TouchableOpacity>
            </View>

            {/* Snapshot preview (collapsed, show first 3) */}
            {(batch.items_snapshot as any[]).slice(0, 3).map((item: any, idx: number) => (
              <View key={idx} style={styles.snapshotRow}>
                <ThemedText variant="small" color="subtitle" style={{ fontSize: S, flex: 1 }}>
                  {item.name}
                </ThemedText>
                <ThemedText variant="small" color="muted" style={{ fontSize: S }}>
                  ×{item.qty}
                </ThemedText>
              </View>
            ))}
            {(batch.items_snapshot as any[]).length > 3 && (
              <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                +{(batch.items_snapshot as any[]).length - 3} more items
              </ThemedText>
            )}
          </View>
        );
      }}
    />
  );
}

// ── Add Item Form (catalog autocomplete; staff-style add) ────
//
// BF-17 polish: tap a suggestion (or the custom row) to add the
// item with qty=1 — no separate qty input, no Add button. Adjust
// qty inline on the row using ± after it appears in the list.

function AddItemForm({
  addCat,
  setAddCat,
  addName,
  setAddName,
  isPending,
  onPick,
  onCancel,
}: {
  addCat: Category;
  setAddCat: (c: Category) => void;
  addName: string;
  setAddName: (s: string) => void;
  isPending: boolean;
  onPick: (name: string) => void;
  onCancel: () => void;
}) {
  const { data: catalog = [] } = useSupplyCatalog(addCat);

  const typed = addName.trim().toLowerCase();
  const suggestions = typed.length > 0
    ? catalog.filter((c) => c.name.toLowerCase().startsWith(typed)).slice(0, 8)
    : [];
  const exactMatch = catalog.some((c) => c.name.toLowerCase() === typed);
  const showCustomAdd = typed.length > 0 && !exactMatch;

  return (
    <View style={styles.addForm}>
      <View style={styles.addFormHeader}>
        <ThemedText variant="body" color="primary" style={[styles.addFormTitle, { fontSize: B }]}>
          Add Item
        </ThemedText>
        <TouchableOpacity onPress={onCancel}>
          <ThemedText variant="body" color="muted" style={{ fontSize: B }}>Cancel</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Category chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Theme.spacing.sm }}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.catChip, addCat === cat && styles.catChipActive]}
            onPress={() => setAddCat(cat)}
          >
            <Text style={[styles.catChipText, addCat === cat && styles.catChipTextActive]}>
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Name input only — qty defaults to 1; adjust ± inline after add */}
      <TextInput
        style={[styles.addInput, styles.addNameInput]}
        placeholder="Type item name…"
        placeholderTextColor={Theme.colors.text.muted}
        value={addName}
        onChangeText={setAddName}
        autoCorrect={false}
        editable={!isPending}
      />

      {(suggestions.length > 0 || showCustomAdd) && (
        <View style={styles.suggestions}>
          {suggestions.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.suggestionRow}
              onPress={() => onPick(item.name)}
              disabled={isPending}
            >
              <ThemedText variant="body" color="primary" style={{ fontSize: B, flex: 1 }}>
                {item.name}
              </ThemedText>
              <ThemedText variant="small" color="mint" style={{ fontSize: S }}>Add ›</ThemedText>
            </TouchableOpacity>
          ))}
          {showCustomAdd && (
            <TouchableOpacity
              style={styles.suggestionRow}
              onPress={() => onPick(addName)}
              disabled={isPending}
            >
              <ThemedText variant="body" color="subtitle" style={{ fontSize: B, flex: 1 }}>
                "{addName.trim()}" (custom)
              </ThemedText>
              <ThemedText variant="small" color="mint" style={{ fontSize: S }}>Add ›</ThemedText>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────

export function StockManagerScreen({ navigation }: { navigation: AdminNavProp }) {
  const [activeTab, setActiveTab] = useState<StockTab>('Current Order');
  const { data: activeItems = [] } = useActiveOrderList();
  const printBatch = usePrintBatch();

  const TABS: StockTab[] = ['Current Order', 'History'];

  // BF-17: shared print flow — scope is either a single category
  // ('Vegetables' | 'Grocery' | 'Stationery') or 'all' for the whole
  // active list. Per-category from each section header; "Print All"
  // from the footer for single-supplier or convenience prints.
  const runPrint = async (scope: Category | 'all') => {
    const targetItems = scope === 'all'
      ? activeItems
      : activeItems.filter((i) => i.category === scope);

    if (targetItems.length === 0) {
      Alert.alert('Empty', scope === 'all' ? 'No items in the order list.' : `No ${scope} items to print.`);
      return;
    }

    const label = scope === 'all' ? 'all items' : scope;
    Alert.alert(
      scope === 'all' ? 'Print All?' : `Print ${scope}?`,
      `Print ${targetItems.length} ${label === 'all items' ? 'item' : label.toLowerCase() + ' item'}${targetItems.length !== 1 ? 's' : ''} and archive this batch? These items will be cleared from the current list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Print & Archive',
          onPress: async () => {
            printBatch.mutate(targetItems, {
              onSuccess: async (_batchId) => {
                const html = buildOrderListHTML(
                  targetItems.map((i) => ({ name: i.name, qty: i.qty, category: i.category })),
                );
                try {
                  const { uri } = await Print.printToFileAsync({ html });
                  await Sharing.shareAsync(uri, {
                    UTI: 'com.adobe.pdf',
                    mimeType: 'application/pdf',
                  });
                } catch {
                  Alert.alert('Archived', `Batch archived. PDF export failed — reprint from History.`);
                }
              },
              onError: (e: any) => Alert.alert('Error', e.message),
            });
          },
        },
      ],
    );
  };

  const handlePrintCategory = (cat: Category) => runPrint(cat);
  const handlePrintAll = () => runPrint('all');

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={[styles.back, { fontSize: B }]}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Stock Manager</ThemedText>
        <View style={styles.spacer} />
      </View>

      {/* Pipe-separated tabs */}
      <View style={styles.topTabs}>
        {TABS.map((tab, idx) => (
          <React.Fragment key={tab}>
            {idx > 0 && (
              <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>
            )}
            <TouchableOpacity style={styles.topTab} onPress={() => setActiveTab(tab)}>
              <ThemedText
                variant="body"
                color={activeTab === tab ? 'primary' : 'muted'}
                style={[styles.tabText, activeTab === tab && styles.tabTextActive]}
              >
                {tab}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      {/* Content */}
      {activeTab === 'Current Order' && (
        <OrderListTab onPrint={handlePrintCategory} onPrintAll={handlePrintAll} />
      )}
      {activeTab === 'History' && <HistoryTab />}
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  back: { minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  topTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: Theme.spacing.sm,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4 },
  topTab: { paddingHorizontal: Theme.spacing.sm },
  tabText: { fontSize: Theme.typography.sizes.body + 6 },
  tabTextActive: { fontWeight: '600' },

  tabContent: { flex: 1 },
  listPad: { paddingBottom: Theme.spacing.xl * 2, paddingTop: Theme.spacing.sm },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Theme.spacing.lg },
  emptyText: { textAlign: 'center', lineHeight: 24 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },
  adjustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
    gap: Theme.spacing.sm,
  },
  adjustInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 6,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
    color: Theme.colors.text.primary,
    fontSize: B,
  },

  // Order list items
  orderItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 6,
    marginHorizontal: 4,
  },
  qtyBtnText: { fontSize: 18, color: Theme.colors.text.primary, lineHeight: 20 },
  qtyNum: { width: 28, textAlign: 'center', fontSize: 16, color: Theme.colors.text.primary, fontWeight: '600' },
  removeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  removeText: { fontSize: 20, color: Theme.colors.status.error, lineHeight: 22 },

  // Add form
  addForm: {
    margin: Theme.spacing.md,
    padding: Theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.text.mint,
    borderRadius: 8,
  },
  addFormHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.sm,
  },
  addFormTitle: { marginBottom: 0 },
  catChip: {
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
    marginRight: Theme.spacing.xs,
  },
  catChipActive: { borderColor: Theme.colors.text.mint, backgroundColor: `${Theme.colors.text.mint}15` },
  catChipText: { fontSize: 13, color: Theme.colors.text.muted },
  catChipTextActive: { color: Theme.colors.text.mint },
  addInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 6,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 8,
    color: Theme.colors.text.primary,
    fontSize: B,
    marginBottom: Theme.spacing.sm,
  },
  addNameInput: { flex: 1 },
  suggestions: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 6,
    marginBottom: Theme.spacing.sm,
    backgroundColor: Theme.colors.background.primary,
  },
  suggestionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },

  // Batch history
  batchCard: {
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 8,
    padding: Theme.spacing.sm,
  },
  batchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Theme.spacing.xs,
  },
  snapshotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
});
