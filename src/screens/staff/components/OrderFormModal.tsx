/**
 * 1stOne F1 — Staff supply Order Form Modal
 *
 * Type-to-search bottom sheet for raising a Vegetables / Grocery /
 * Stationery supply order to admin. Extracted from StaffDashboard (audit
 * D22) — self-contained: its catalog hook + styles live here.
 */

import React, { useState } from 'react';
import { infoDialog } from '../../../utils/confirmDialog';
import {
  View,
  TextInput,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Text,
  Modal,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  StyleSheet,
} from 'react-native';
import { getErrorMessage } from '../../../utils/formatters';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { useAuth } from '../../../hooks/useAuth';
import { supabase } from '../../../api/supabaseClient';
import { useSupabaseQuery } from '../../../api/useSupabaseQuery';

export type OrderFormType = 'Vegetables' | 'Grocery' | 'Stationery' | null;

interface LineItem {
  id: string;
  name: string;
  qty: number;
}

function useSupplyCatalog(type: OrderFormType) {
  return useSupabaseQuery<{ id: string; name: string }>(
    ['supply_catalog', type],
    // `enabled` gates this to a non-null type; `?? ''` only satisfies the type.
    () =>
      supabase
        .from('supply_catalog')
        .select('id, name')
        .eq('category', type ?? '')
        .eq('is_active', true)
        .order('name'),
    {
      enabled: !!type,
      staleTime: 5 * 60_000,
      // Refetch when the modal opens — protects against stale empty cache
      // (e.g., from a previous session or pre-auth state).
      refetchOnMount: 'always',
    },
  );
}

export function OrderFormModal({
  type,
  onClose,
}: {
  type: OrderFormType;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { session } = useAuth();

  const { data: catalog = [] } = useSupplyCatalog(type);

  // Reset when modal opens for a new type
  React.useEffect(() => {
    if (type) { setSearch(''); setLineItems([]); }
  }, [type]);

  if (!type) return null;

  // Type-to-search only — empty search shows nothing (matches admin Stock Manager).
  // Avoids overwhelming the user with the full catalog on modal open.
  const addedIds = new Set(lineItems.map((i) => i.id));
  const suggestions = search.trim().length > 0
    ? catalog.filter(
        (c) => c.name.toLowerCase().startsWith(search.toLowerCase()) && !addedIds.has(c.id)
      )
    : [];

  // Allow adding a custom entry if no exact match in catalog
  const exactMatch = catalog.some((c) => c.name.toLowerCase() === search.trim().toLowerCase());
  const showCustomAdd = search.trim().length > 0 && !exactMatch;

  const addFromCatalog = (item: { id: string; name: string }) => {
    setSearch('');
    setLineItems((prev) => [...prev, { id: item.id, name: item.name, qty: 1 }]);
    // Dismiss keyboard so the line-items list below is visible after each add.
    Keyboard.dismiss();
  };

  const addCustom = () => {
    const name = search.trim();
    if (!name) return;
    setSearch('');
    setLineItems((prev) => [...prev, { id: `custom_${Date.now()}`, name, qty: 1 }]);
    Keyboard.dismiss();
  };

  const removeItem = (id: string) => setLineItems((prev) => prev.filter((i) => i.id !== id));

  const changeQty = (id: string, delta: number) => {
    setLineItems((prev) =>
      prev
        .map((i) => i.id === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i)
    );
  };

  const handleSubmit = async () => {
    if (lineItems.length === 0) {
      infoDialog('Empty order', 'Add at least one item.');
      return;
    }
    setSubmitting(true);
    try {
      const { error: insertErr } = await supabase.from('staff_order_requests').insert({
        request_type: type,
        items: lineItems.map((i) => ({ name: i.name, qty: i.qty })),
        status: 'Pending',
        submitted_by: session?.user.id ?? null,
      });
      if (insertErr) throw insertErr;
      infoDialog('Submitted', `${type} order sent to admin for approval.`);
      onClose();
    } catch (e) {
      infoDialog('Submit failed', getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const showSuggestions = suggestions.length > 0 || showCustomAdd;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={formModal.backdrop} />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={formModal.kavWrap}
        pointerEvents="box-none"
      >
      <View style={formModal.sheet} pointerEvents="auto">
        {/* Header */}
        <View style={formModal.header}>
          <ThemedText variant="subtitle" color="primary">{type} Order</ThemedText>
          <TouchableOpacity onPress={onClose}>
            <ThemedText variant="body" color="muted">Cancel</ThemedText>
          </TouchableOpacity>
        </View>

        {/* Search input */}
        <View style={formModal.searchRow}>
          <TextInput
            style={formModal.searchInput}
            placeholder="Type item name…"
            placeholderTextColor={Theme.colors.text.muted}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {search.trim().length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} style={formModal.clearBtn}>
              <Text style={formModal.clearText}>×</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Suggestions — bounded scroll so a long catalog doesn't push the line-items list off-screen */}
        {showSuggestions && (
          <ScrollView style={formModal.suggestions} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {suggestions.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={formModal.suggestionRow}
                onPress={() => addFromCatalog(item)}
              >
                <ThemedText variant="body" color="primary">{item.name}</ThemedText>
                <ThemedText variant="small" color="mint">+ Add</ThemedText>
              </TouchableOpacity>
            ))}
            {showCustomAdd && (
              <TouchableOpacity style={formModal.suggestionRow} onPress={addCustom}>
                <ThemedText variant="body" color="subtitle">"{search.trim()}"</ThemedText>
                <ThemedText variant="small" color="mint">+ Add</ThemedText>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* Line items */}
        {lineItems.length > 0 && (
          <ScrollView style={formModal.lineList} keyboardShouldPersistTaps="handled">
            {lineItems.map((item) => (
              <View key={item.id} style={formModal.lineRow}>
                <ThemedText variant="body" color="primary" style={{ flex: 1 }}>
                  {item.name}
                </ThemedText>
                {/* Qty controls */}
                <TouchableOpacity onPress={() => changeQty(item.id, -1)} style={formModal.qtyBtn}>
                  <Text style={formModal.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={formModal.qtyNum}>{item.qty}</Text>
                <TouchableOpacity onPress={() => changeQty(item.id, +1)} style={formModal.qtyBtn}>
                  <Text style={formModal.qtyBtnText}>+</Text>
                </TouchableOpacity>
                {/* Remove */}
                <TouchableOpacity onPress={() => removeItem(item.id)} style={formModal.removeBtn}>
                  <Text style={formModal.removeText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        {lineItems.length === 0 && !showSuggestions && (
          <ThemedText variant="small" color="muted" style={formModal.emptyHint}>
            Start typing to search or add items
          </ThemedText>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[formModal.submitRow, lineItems.length === 0 && formModal.submitDisabled]}
          onPress={handleSubmit}
          disabled={submitting || lineItems.length === 0}
        >
          <ThemedText variant="body" color={lineItems.length > 0 ? 'mint' : 'muted'}>
            {submitting ? 'Submitting…' : `Submit ${type} Order (${lineItems.length} item${lineItems.length !== 1 ? 's' : ''})  ›`}
          </ThemedText>
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const formModal = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Theme.colors.layout.overlayMedium,
  },
  // Full-screen flex container — sheet sits at the bottom via justifyContent.
  // KeyboardAvoidingView resizes this on keyboard open without breaking the
  // sheet's layout (avoids the position:absolute conflict that broke v1.0.2).
  kavWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    backgroundColor: Theme.colors.background.secondary,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl + Theme.spacing.md,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    marginBottom: Theme.spacing.xs,
  },
  searchInput: {
    flex: 1,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    paddingVertical: Theme.spacing.sm,
  },
  clearBtn: { paddingHorizontal: Theme.spacing.sm },
  clearText: {
    color: Theme.colors.text.muted,
    fontSize: Theme.typography.sizes.subtitle,
    lineHeight: 22,
  },
  suggestions: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 6,
    marginBottom: Theme.spacing.sm,
    backgroundColor: Theme.colors.background.primary,
    maxHeight: 220,
  },
  suggestionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  lineList: { maxHeight: 220 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  qtyBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.subtitle,
    lineHeight: 22,
  },
  qtyNum: {
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    minWidth: 24,
    textAlign: 'center',
  },
  removeBtn: {
    paddingLeft: Theme.spacing.sm,
    paddingRight: 2,
  },
  removeText: {
    color: Theme.colors.status.error,
    fontSize: Theme.typography.sizes.subtitle,
    lineHeight: 22,
    fontFamily: Theme.typography.fontFamily,
  },
  emptyHint: {
    paddingVertical: Theme.spacing.md,
    textAlign: 'center',
  },
  submitRow: {
    alignSelf: 'flex-end',
    paddingTop: Theme.spacing.md,
  },
  submitDisabled: { opacity: 0.4 },
});
