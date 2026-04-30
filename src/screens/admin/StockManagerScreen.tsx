/**
 * 1stOne F1 — Stock Manager (Admin)
 *
 * 3 tabs:
 *   Requests  — pending staff supply requests; approve / reject inline
 *   Order List — current consolidated order (approved + admin-added); edit qty, remove; Print All footer
 *   History   — past print batches; reprint option
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
  usePendingSupplyRequests,
  useReviewSupplyRequest,
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

type StockTab = 'Requests' | 'Order List' | 'History';
type Category = 'Vegetables' | 'Grocery' | 'Stationery';

const CATEGORIES: Category[] = ['Vegetables', 'Grocery', 'Stationery'];

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

// ── Requests Tab ─────────────────────────────────────────

function RequestsTab() {
  const { data: requests = [], isLoading, refetch } = usePendingSupplyRequests();
  const review = useReviewSupplyRequest();

  const handleApprove = (req: any) => {
    Alert.alert(
      'Approve Request',
      `Approve ${req.request_type} order from ${req.profiles?.full_name ?? 'staff'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () =>
            review.mutate(
              {
                requestId: req.id,
                action: 'Approved',
                items: req.items,
                category: req.request_type,
              },
              { onError: (e: any) => Alert.alert('Error', e.message) },
            ),
        },
      ],
    );
  };

  const handleReject = (req: any) => {
    Alert.alert(
      'Reject Request',
      `Reject this ${req.request_type} order?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: () =>
            review.mutate(
              { requestId: req.id, action: 'Rejected' },
              { onError: (e: any) => Alert.alert('Error', e.message) },
            ),
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Theme.colors.action.primary} />
      </View>
    );
  }

  if (requests.length === 0) {
    return (
      <View style={styles.center}>
        <ThemedText variant="body" color="muted" style={styles.emptyText}>
          No pending requests
        </ThemedText>
      </View>
    );
  }

  return (
    <FlatList
      data={requests}
      keyExtractor={(r) => String(r.id)}
      contentContainerStyle={styles.listPad}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Theme.colors.action.primary} />
      }
      renderItem={({ item: req }) => (
        <View style={styles.requestCard}>
          {/* Header row */}
          <View style={styles.requestHeader}>
            <View style={[styles.catBadge, { backgroundColor: catColor(req.request_type) }]}>
              <Text style={styles.catBadgeText}>{req.request_type}</Text>
            </View>
            <ThemedText variant="small" color="muted" style={{ fontSize: S }}>
              {req.profiles?.employee_id ?? ''}  {req.profiles?.full_name ?? 'Staff'}
            </ThemedText>
          </View>

          {/* Items list */}
          {(req.items as { name: string; qty: number }[]).map((item, idx) => (
            <View key={idx} style={styles.requestItemRow}>
              <ThemedText variant="body" color="primary" style={{ fontSize: B, flex: 1 }}>
                {item.name}
              </ThemedText>
              <ThemedText variant="body" color="muted" style={{ fontSize: B }}>
                ×{item.qty}
              </ThemedText>
            </View>
          ))}

          {/* Actions */}
          <View style={styles.requestActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.rejectBtn]}
              onPress={() => handleReject(req)}
              disabled={review.isPending}
            >
              <Text style={[styles.actionBtnText, { color: Theme.colors.status.error }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.approveBtn]}
              onPress={() => handleApprove(req)}
              disabled={review.isPending}
            >
              <Text style={[styles.actionBtnText, { color: Theme.colors.status.success }]}>
                Approve ›
              </Text>
            </TouchableOpacity>
          </View>

          <ThemedText variant="small" color="muted" style={[styles.reqDate, { fontSize: S }]}>
            {new Date(req.created_at).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </ThemedText>
        </View>
      )}
    />
  );
}

// ── Order List Tab ───────────────────────────────────────

function OrderListTab({ onPrint }: { onPrint: () => void }) {
  const { data: items = [], isLoading, refetch } = useActiveOrderList();
  const updateQty = useUpdateOrderItemQty();
  const remove = useRemoveOrderItem();
  const addItem = useAdminAddOrderItem();

  const [addName, setAddName] = useState('');
  const [addQty, setAddQty] = useState('0');
  const [addCat, setAddCat] = useState<Category>('Vegetables');
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAdd = () => {
    const name = addName.trim();
    const qty = parseInt(addQty, 10);
    if (!name) { Alert.alert('Name required'); return; }
    if (!qty || qty < 1) { Alert.alert('Enter a valid quantity'); return; }
    addItem.mutate(
      { name, qty, category: addCat },
      {
        // Stay open so admin can add multiple items in a row.
        // Cancel button (or tab change) closes the form.
        onSuccess: () => { setAddName(''); setAddQty('0'); },
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
            No items in the current order list.{'\n'}Approve staff requests or add items manually.
          </ThemedText>
        )}

        {grouped.map(({ cat, items: catItems }) => (
          <View key={cat}>
            <View style={styles.section}>
              <ThemedText variant="small" color="muted" style={{ fontSize: S, letterSpacing: 1 }}>
                {cat.toUpperCase()}
              </ThemedText>
            </View>
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
          independently above it; form stays visible while adding. */}
      {showAddForm && (
        <AddItemForm
          addCat={addCat}
          setAddCat={setAddCat}
          addName={addName}
          setAddName={setAddName}
          addQty={addQty}
          setAddQty={setAddQty}
          isPending={addItem.isPending}
          onAdd={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Footer — hidden while adding so the form has room above the keyboard */}
      {!showAddForm && (
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => setShowAddForm(true)}>
            <ThemedText variant="body" color="accent" style={{ fontSize: B }}>+ Add Item</ThemedText>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {items.length > 0 && (
            <TouchableOpacity onPress={onPrint}>
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

// ── Add Item Form (with catalog autocomplete) ────────────

function AddItemForm({
  addCat,
  setAddCat,
  addName,
  setAddName,
  addQty,
  setAddQty,
  isPending,
  onAdd,
  onCancel,
}: {
  addCat: Category;
  setAddCat: (c: Category) => void;
  addName: string;
  setAddName: (s: string) => void;
  addQty: string;
  setAddQty: (s: string) => void;
  isPending: boolean;
  onAdd: () => void;
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
      <ThemedText variant="body" color="primary" style={[styles.addFormTitle, { fontSize: B }]}>
        Add Item
      </ThemedText>

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

      {/* Name + Qty on a single row to keep the form compact */}
      <View style={styles.addNameQtyRow}>
        <TextInput
          style={[styles.addInput, styles.addNameInput]}
          placeholder="Type item name…"
          placeholderTextColor={Theme.colors.text.muted}
          value={addName}
          onChangeText={setAddName}
          autoCorrect={false}
        />
        <TextInput
          style={[styles.addInput, styles.addQtyInput]}
          placeholder="Qty"
          placeholderTextColor={Theme.colors.text.muted}
          keyboardType="number-pad"
          value={addQty}
          onChangeText={setAddQty}
          textAlign="center"
        />
      </View>

      {(suggestions.length > 0 || showCustomAdd) && (
        <View style={styles.suggestions}>
          {suggestions.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.suggestionRow}
              onPress={() => setAddName(item.name)}
            >
              <ThemedText variant="body" color="primary" style={{ fontSize: B, flex: 1 }}>
                {item.name}
              </ThemedText>
              <ThemedText variant="small" color="mint" style={{ fontSize: S }}>Pick</ThemedText>
            </TouchableOpacity>
          ))}
          {showCustomAdd && (
            <View style={styles.suggestionRow}>
              <ThemedText variant="body" color="subtitle" style={{ fontSize: B, flex: 1 }}>
                "{addName.trim()}" (custom)
              </ThemedText>
            </View>
          )}
        </View>
      )}

      <View style={styles.addFormBtns}>
        <TouchableOpacity onPress={onCancel} style={styles.addCancelBtn}>
          <ThemedText variant="body" color="muted" style={{ fontSize: B }}>Cancel</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onAdd}
          disabled={isPending}
          style={styles.addSaveBtn}
        >
          <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Add ›</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────

export function StockManagerScreen({ navigation }: { navigation: AdminNavProp }) {
  const [activeTab, setActiveTab] = useState<StockTab>('Requests');
  const { data: pendingRequests = [] } = usePendingSupplyRequests();
  const { data: activeItems = [] } = useActiveOrderList();
  const printBatch = usePrintBatch();

  const TABS: StockTab[] = ['Requests', 'Order List', 'History'];

  const handlePrintAll = async () => {
    if (activeItems.length === 0) {
      Alert.alert('Empty', 'No items in the order list.');
      return;
    }

    Alert.alert(
      'Print & Archive',
      `Print all ${activeItems.length} items and archive this batch? The current list will be cleared.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Print & Archive',
          onPress: async () => {
            printBatch.mutate(activeItems, {
              onSuccess: async (_batchId) => {
                const html = buildOrderListHTML(
                  activeItems.map((i) => ({ name: i.name, qty: i.qty, category: i.category })),
                );
                try {
                  const { uri } = await Print.printToFileAsync({ html });
                  await Sharing.shareAsync(uri, {
                    UTI: 'com.adobe.pdf',
                    mimeType: 'application/pdf',
                  });
                } catch {
                  Alert.alert('Archived', 'Batch archived. PDF export failed — reprint from History.');
                }
              },
              onError: (e: any) => Alert.alert('Error', e.message),
            });
          },
        },
      ],
    );
  };

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
        {TABS.map((tab, idx) => {
          const badge =
            tab === 'Requests' && pendingRequests.length > 0
              ? ` (${pendingRequests.length})`
              : '';
          return (
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
                  {tab}{badge}
                </ThemedText>
              </TouchableOpacity>
            </React.Fragment>
          );
        })}
      </View>

      {/* Content */}
      {activeTab === 'Requests' && <RequestsTab />}
      {activeTab === 'Order List' && <OrderListTab onPrint={handlePrintAll} />}
      {activeTab === 'History' && <HistoryTab />}
    </SafeAreaView>
  );
}

// ── Helpers ──────────────────────────────────────────────

function catColor(cat: string): string {
  switch (cat) {
    case 'Vegetables': return '#4CAF5020';
    case 'Grocery': return '#FF980020';
    case 'Stationery': return '#2196F320';
    default: return Theme.colors.layout.divider;
  }
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

  section: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },

  // Request cards
  requestCard: {
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 8,
    padding: Theme.spacing.sm,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
  },
  catBadge: {
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  catBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.text.primary,
  },
  requestItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  requestActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.sm,
  },
  actionBtn: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 6,
    borderWidth: 1,
  },
  rejectBtn: { borderColor: Theme.colors.status.error },
  approveBtn: { borderColor: Theme.colors.status.success },
  actionBtnText: { fontSize: 14, fontWeight: '500' },
  reqDate: { marginTop: 4, textAlign: 'right' },

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
  addFormTitle: { marginBottom: Theme.spacing.sm },
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
  addNameQtyRow: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  addNameInput: { flex: 1 },
  addQtyInput: { width: 64 },
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
  addFormBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: Theme.spacing.md },
  addCancelBtn: { padding: Theme.spacing.xs },
  addSaveBtn: { padding: Theme.spacing.xs },

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
