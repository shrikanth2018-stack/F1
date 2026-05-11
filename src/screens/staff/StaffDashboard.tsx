/**
 * 1stOne F1 — Staff Dashboard
 *
 * Header: Logo + profile circle popup
 * Tabs: Kitchen  |  Packing  |  Delivery  (pipe-separated, +4pt)
 * Staff message bar below header (from admin)
 *
 * Kitchen: aggregated item list, Confirmed → Ready toggle
 *   Floating: Mark all to next ›
 *   Footer: Vegetables order  |  Grocery order
 *
 * Packing: Food / Essentials sub-tabs, order-level list
 *   Floating: Mark all to next ›
 *   Footer: Print all labels  |  Print summary  (then gap)  Stationery order
 *
 * Delivery: all dispatched orders, On the Way / Delivered toggle
 *   Footer: Route map PDF
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Image,
  FlatList,
  TouchableOpacity,
  TextInput,
  ScrollView,
  RefreshControl,
  Alert,
  Linking,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
  Text,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import {
  useStaffOrders,
  useUpdateOrderStatus,
} from '../../hooks/useStaffOrders';
import { useAllMenuItems } from '../../hooks/useMenuManagement';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { useAuth } from '../../hooks/useAuth';
import { useWalletBalance } from '../../hooks/useWallet';
import { useStaffNoteForTab, type NoteTarget } from '../../hooks/useAdminNotes';
import { supabase } from '../../api/supabaseClient';
import { useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '../../types';
import { confirmDialog } from '../../utils/confirmDialog';

type StaffTab = 'Kitchen' | 'Packing';
type PackingSubTab = 'Food' | 'Essentials';
type OrderFormType = 'Vegetables' | 'Grocery' | 'Stationery' | null;

const LOGO_URL = supabase.storage.from('assets').getPublicUrl('logo.png').data.publicUrl;
// Direct URL string (matches Privacy/Terms PDF pattern) so Linking.openURL
// opens it inline in the browser instead of triggering a download.
// The Supabase SDK's getPublicUrl was appending params that signaled
// attachment behavior to Android.

// Text size offsets for this screen
const BODY2 = Theme.typography.sizes.body + 2;
const SMALL2 = Theme.typography.sizes.small + 2;

function statusColor(status: OrderStatus): string {
  switch (status) {
    case 'Confirmed': return Theme.colors.status.info;
    case 'Preparing': return Theme.colors.status.warning;
    case 'Ready': return Theme.colors.status.success;
    case 'Packed': return Theme.colors.action.primary;
    case 'Dispatched': return Theme.colors.action.primary;
    case 'Received at Hub': return Theme.colors.status.info;
    case 'On the Way': return Theme.colors.status.warning;
    case 'Delivered': return Theme.colors.status.success;
    case 'Cancelled': return Theme.colors.status.error;
    default: return Theme.colors.text.muted;
  }
}

// ── Aggregate kitchen items from orders ──────────────────
interface AggregateItem {
  key: string;
  item_name: string;
  /** Unit suffix ("g", "ml", "") — blank means integer count */
  unit: string;
  total_quantity: number;
  status: OrderStatus;
  order_ids: number[];
}

/**
 * Parse a menu item's `ingredients` text into a list of component x qty.
 *   Input  : "Rice:200g;Sambar:100ml;Chapati:2"
 *   Output : [{ name: "Rice", unit: "200g" }, ...]
 *
 * The trailing token can be a unit string (200g, 100ml) or an integer count (2).
 * For aggregation we treat integer tokens as a count multiplier; string units we
 * aggregate by distinct unit label so the kitchen sees "2 Chapati" vs "200g Rice".
 */
function parseIngredientTokens(raw: string | null | undefined): Array<{ name: string; token: string }> {
  if (!raw) return [];
  return raw
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [name, token] = chunk.split(':').map((s) => s?.trim() ?? '');
      return { name: name || '', token: token || '1' };
    })
    .filter((x) => x.name.length > 0);
}

/**
 * Kitchen aggregator — COMPONENT view.
 *
 * For every ordered meal, look up its menu_item.ingredients and aggregate by
 * component. 10 "Mini Lunch" orders with ingredients "Rice:200g;Sambar:100ml"
 * become "2000g Rice, 1000ml Sambar" for the kitchen to prep.
 *
 * Integer tokens are multiplied (e.g. Chapati:2 × 10 orders = 20 Chapati).
 * Suffixed tokens (200g, 100ml) extract the numeric prefix, multiply, reapply unit.
 *
 * Graceful fallback: if a menu_item has no ingredients defined, the meal name
 * itself becomes the component so the kitchen still sees something.
 */
function aggregateKitchenItems(
  orders: any[],
  ingredientsByItemId: Record<number, string | null>,
): AggregateItem[] {
  const relevant = orders.filter((o) => o.status !== 'Cancelled');
  const map = new Map<string, AggregateItem>();

  const mergeInto = (
    name: string,
    rawToken: string,
    qty: number,
    status: OrderStatus,
    orderId: number,
  ) => {
    // Extract optional numeric prefix and unit suffix from the token.
    // "200g" → { num: 200, unit: "g" }, "2" → { num: 2, unit: "" }
    const m = rawToken.match(/^(\d*\.?\d+)\s*(.*)$/);
    const numeric = m ? parseFloat(m[1]) : 1;
    const unit = (m ? m[2] : '').trim();
    const totalNumeric = numeric * qty;

    const key = `${name}__${unit}__${status}`;
    const existing = map.get(key);
    if (existing) {
      existing.total_quantity += totalNumeric;
      if (!existing.order_ids.includes(orderId)) existing.order_ids.push(orderId);
    } else {
      map.set(key, {
        key,
        item_name: unit ? `${name}${unit ? '' : ''}` : name,
        unit,
        total_quantity: totalNumeric,
        status,
        order_ids: [orderId],
      });
    }
  };

  for (const order of relevant) {
    for (const oi of order.order_items ?? []) {
      // Only food item_types contribute to kitchen prep
      if (oi.item_type && oi.item_type !== 'food') continue;

      const ingredientsText = oi.item_id != null ? ingredientsByItemId[oi.item_id] : null;
      const components = parseIngredientTokens(ingredientsText);

      if (components.length === 0) {
        // Fallback — no breakdown defined, show the meal itself
        mergeInto(oi.item_name ?? `Item #${oi.item_id}`, String(oi.quantity), 1, order.status, order.id);
      } else {
        for (const c of components) {
          mergeInto(c.name, c.token, oi.quantity, order.status, order.id);
        }
      }
    }
  }

  const statusOrder = [
    'Confirmed', 'Preparing', 'Ready',
    'Packed', 'Dispatched', 'Received at Hub', 'On the Way', 'Delivered',
  ];
  return Array.from(map.values()).sort(
    (a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
  );
}

// ── Staff message bar ────────────────────────────────────
function useStaffMessage() {
  return useQuery({
    queryKey: ['staff_message'],
    queryFn: async () => {
      const { data } = await supabase
        .from('store_config')
        .select('staff_message')
        .limit(1)
        .single();
      return (data as any)?.staff_message as string | null ?? null;
    },
    staleTime: 60_000,
  });
}

// ── Order Form Modal ─────────────────────────────────────
interface LineItem {
  id: string;
  name: string;
  qty: number;
}

function useSupplyCatalog(type: OrderFormType) {
  return useQuery({
    queryKey: ['supply_catalog', type],
    queryFn: async () => {
      if (!type) return [];
      const { data } = await supabase
        .from('supply_catalog')
        .select('id, name')
        .eq('category', type)
        .eq('is_active', true)
        .order('name');
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: !!type,
    staleTime: 5 * 60_000,
    // Refetch when the modal opens — protects against stale empty cache
    // (e.g., from a previous session or pre-auth state).
    refetchOnMount: 'always',
  });
}

function OrderFormModal({
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
      Alert.alert('Empty order', 'Add at least one item.');
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
      Alert.alert('Submitted', `${type} order sent to admin for approval.`);
      onClose();
    } catch (e: any) {
      Alert.alert('Submit failed', e?.message ?? 'Could not submit the order. Try again.');
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

// ── Profile Popup ────────────────────────────────────────
function ProfilePopup({
  visible,
  staffName,
  onClose,
}: {
  visible: boolean;
  staffName: string;
  onClose: () => void;
}) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();

  const go = (screen: string) => {
    onClose();
    setTimeout(() => navigation.navigate(screen), 150);
  };

  const handleSignOut = async () => {
    onClose();
    const confirmed = await confirmDialog({
      title: 'Sign Out',
      message: 'Are you sure?',
      confirmLabel: 'Sign Out',
      destructive: true,
    });
    if (confirmed) signOut();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={popup.backdrop} />
      </TouchableWithoutFeedback>

      <View style={[popup.box, { top: insets.top + 70 }]}>
        <View style={popup.userSection}>
          <ThemedText variant="subtitle" color="mint">{staffName}</ThemedText>
          <ThemedText variant="small" color="muted">Staff</ThemedText>
        </View>

        <Divider />

        <TouchableOpacity style={popup.row} onPress={() => go('Attendance')}>
          <ThemedText variant="body" color="primary">Attendance</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={popup.row} onPress={() => go('StaffExpenses')}>
          <ThemedText variant="body" color="primary">Expense Claim</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={popup.row} onPress={() => go('StaffProfile')}>
          <ThemedText variant="body" color="primary">My Profile</ThemedText>
        </TouchableOpacity>

        <Divider />

        <View style={popup.footer}>
          <TouchableOpacity onPress={onClose} style={popup.footerBtn}>
            <ThemedText variant="body" color="muted">Close</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSignOut} style={popup.footerBtn}>
            <ThemedText variant="body" color="primary" style={popup.logoutText}>Sign Out</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Dashboard ───────────────────────────────────────
export function StaffDashboard() {
  const [activeTab, setActiveTab] = useState<StaffTab>('Kitchen');
  const [packingSubTab, setPackingSubTab] = useState<PackingSubTab>('Food');
  const [profileVisible, setProfileVisible] = useState(false);
  const [orderFormType, setOrderFormType] = useState<OrderFormType>(null);

  const { session } = useAuth();
  const { data: profile } = useWalletBalance();
  const { data: orders, isLoading, isError, refetch } = useStaffOrders(undefined);
  const updateStatus = useUpdateOrderStatus();
  const { pendingCount } = useOfflineSync();
  // Deprecated: single staff_message from store_config (kept as last-resort fallback)
  const { data: legacyStaffMessage } = useStaffMessage();

  // Active admin notes targeting the current tab (+ broadcasts targeting 'all')
  const tabKey: NoteTarget =
    activeTab === 'Kitchen' ? 'kitchen' :
    activeTab === 'Packing' ? 'packing' : 'all';
  const { data: tabNotes = [] } = useStaffNoteForTab(tabKey);

  useRealtimeOrders(true);

  const staffName = profile?.fullName || (session?.user.phone ? `...${session.user.phone.slice(-4)}` : 'Staff');
  const staffInitial = (profile?.fullName?.[0] ?? 'S').toUpperCase();

  // ── Order filters ────────────────────────────
  const kitchenOrders = useMemo(
    () => (orders ?? []).filter((o) => o.order_type === 'food' && o.status !== 'Cancelled'),
    [orders]
  );

  const packingOrders = useMemo(
    () => (orders ?? []).filter((o) => {
      if (o.status === 'Cancelled') return false;
      return packingSubTab === 'Food'
        ? o.order_type === 'food'
        : o.order_type === 'essential';
    }),
    [orders, packingSubTab]
  );

  // Derive the driver code/label for any order — used by Packing's print-by-driver
  // grouping. The Delivery tab that historically used this has moved to
  // DriverDashboardScreen + admin DeliveryManager Live tab.
  const getDriverInfoFor = useCallback((o: any): { code: string | null; label: string } => {
    const addr = o?.customer_addresses;
    if (o?.delivery_method === 'hub') {
      const hub = addr?.delivery_hubs;
      const code = hub?.driver_code ?? null;
      const hubName = hub?.hub_name ?? 'Hub';
      return { code, label: code ? `Branch → ${hubName}` : `Unassigned → ${hubName}` };
    }
    const zone = addr?.delivery_zones;
    const code = zone?.driver_code ?? null;
    return { code, label: code ? `Driver ${code}` : 'Unassigned' };
  }, []);

  // Build item_id → ingredients map from the full menu catalog.
  // Used by the kitchen aggregator to break each meal into its components.
  const { data: allMenu = [] } = useAllMenuItems();
  const ingredientsByItemId = useMemo(() => {
    const m: Record<number, string | null> = {};
    for (const mi of allMenu as any[]) {
      if (mi.id != null) m[mi.id] = mi.ingredients ?? null;
    }
    return m;
  }, [allMenu]);

  const kitchenItems = useMemo(
    () => aggregateKitchenItems(kitchenOrders, ingredientsByItemId),
    [kitchenOrders, ingredientsByItemId]
  );

  // ── Handlers ─────────────────────────────────
  const handleStatusUpdate = useCallback((orderId: number, next: OrderStatus) => {
    const order = (orders ?? []).find((o) => o.id === orderId);
    updateStatus.mutate({ orderId, status: next, userId: order?.user_id });
  }, [updateStatus, orders]);

  const handleMarkAllKitchenReady = useCallback(() => {
    const toMark = (orders ?? []).filter(
      (o) => o.status === 'Confirmed' || o.status === 'Preparing'
    );
    if (toMark.length === 0) return;
    Alert.alert('Mark All as Ready', `Mark ${toMark.length} order(s) as Ready?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Ready',
        onPress: () => {
          for (const o of toMark) {
            updateStatus.mutate({ orderId: o.id, status: 'Ready', userId: o.user_id });
          }
        },
      },
    ]);
  }, [orders, updateStatus]);

  const handleMarkAllPacked = useCallback(() => {
    // BF-34b (F3.2): include 'Confirmed' essentials — they have no
    // 'Ready' intermediate and Packing is their first-hop surface.
    const toMark = packingOrders.filter((o) =>
      o.status === 'Ready' ||
      (o.status === 'Confirmed' && o.order_type === 'essential'),
    );
    if (toMark.length === 0) return;
    Alert.alert('Mark All as Packed', `Mark ${toMark.length} order(s) as Packed?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Packed',
        onPress: () => {
          for (const o of toMark) {
            updateStatus.mutate({ orderId: o.id, status: 'Packed', userId: o.user_id });
          }
        },
      },
    ]);
  }, [packingOrders, updateStatus]);

  const handleCall = (phone?: string) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`);
  };

  // ── Print helpers (expo-print) ───────────────────────────
  const handlePrintOrderLabel = async (item: any) => {
    const addr = item.customer_addresses;
    const items = (item.order_items ?? [])
      .map((i: any) => `<li>${i.item_name} &times;${i.quantity}</li>`)
      .join('');
    const html = `<!DOCTYPE html><html><head><style>
      body{font-family:Arial,sans-serif;padding:20px}
      .label{border:2px solid #000;padding:20px;max-width:320px}
      h2{margin:0 0 8px 0}p{margin:3px 0}
      ul{margin:10px 0 0;padding-left:18px;border-top:1px solid #000;padding-top:10px}
    </style></head><body>
      <div class="label">
        <h2>Order #${item.id}</h2>
        <p><strong>${addr?.full_name ?? '—'}</strong></p>
        <p>${addr?.address_line ?? '—'}</p>
        ${addr?.landmark ? `<p>${addr.landmark}</p>` : ''}
        ${addr?.city ? `<p>${addr.city}</p>` : ''}
        <ul>${items || '<li>—</li>'}</ul>
      </div>
    </body></html>`;
    try {
      await Print.printAsync({ html });
    } catch {
      Alert.alert('Print Error', 'Could not open print dialog.');
    }
  };

  // Render a single label block for an order (shared HTML fragment builder).
  const renderLabelBlock = (order: any) => {
    const addr = order.customer_addresses;
    const items = (order.order_items ?? [])
      .map((i: any) => `<li>${i.item_name} &times;${i.quantity}</li>`)
      .join('');
    return `<div class="label">
      <h2>Order #${order.id}</h2>
      <p><strong>${addr?.full_name ?? '—'}</strong></p>
      <p>${addr?.address_line ?? '—'}</p>
      ${addr?.landmark ? `<p>${addr.landmark}</p>` : ''}
      ${addr?.city ? `<p>${addr.city}</p>` : ''}
      <ul>${items || '<li>—</li>'}</ul>
    </div>`;
  };

  const LABEL_STYLES = `body{font-family:Arial,sans-serif;margin:0}
    .section{page-break-after:always;padding:10px}
    .section:last-child{page-break-after:auto}
    .sectionTitle{font-size:16px;font-weight:bold;margin:6px 0 12px 0;padding:6px 10px;background:#000;color:#fff}
    .label{page-break-inside:avoid;border:2px solid #000;padding:16px;margin:8px 0}
    h2{margin:0 0 6px 0}p{margin:2px 0}
    ul{margin:8px 0 0;padding-left:18px;border-top:1px solid #000;padding-top:8px}`;

  /** One page-break per hub. Only hub-bound orders; branch driver picks up bundles. */
  const handlePrintByHub = async () => {
    const hubOrders = packingOrders.filter((o: any) => o.delivery_method === 'hub');
    if (hubOrders.length === 0) {
      Alert.alert('No hub orders', 'No hub-bound orders to print.');
      return;
    }
    const groups = new Map<string, { hubName: string; orders: any[] }>();
    for (const o of hubOrders) {
      const hub = o.customer_addresses?.delivery_hubs;
      const key = String(hub?.hub_name ?? 'Unknown Hub');
      const entry = groups.get(key) ?? { hubName: key, orders: [] };
      entry.orders.push(o);
      groups.set(key, entry);
    }
    const sections = Array.from(groups.values()).map((g) => {
      const labels = g.orders.map(renderLabelBlock).join('');
      return `<div class="section">
        <div class="sectionTitle">${g.hubName} — ${g.orders.length} order${g.orders.length !== 1 ? 's' : ''}</div>
        ${labels}
      </div>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><style>${LABEL_STYLES}</style></head><body>${sections}</body></html>`;
    try { await Print.printAsync({ html }); }
    catch { Alert.alert('Print Error', 'Could not open print dialog.'); }
  };

  /** One page-break per driver code. Combines direct (zone driver) + hub (branch driver) orders. */
  const handlePrintByDriver = async () => {
    if (packingOrders.length === 0) {
      Alert.alert('No orders', 'No orders to print.');
      return;
    }
    const groups = new Map<string, { title: string; orders: any[] }>();
    for (const o of packingOrders) {
      const info = getDriverInfoFor(o);
      const key = info.code ?? '__unassigned__';
      const title = info.code ? `Driver ${info.code}` : 'Unassigned';
      const entry = groups.get(key) ?? { title, orders: [] };
      entry.orders.push(o);
      groups.set(key, entry);
    }
    const sections = Array.from(groups.values())
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((g) => {
        const labels = g.orders.map(renderLabelBlock).join('');
        return `<div class="section">
          <div class="sectionTitle">${g.title} — ${g.orders.length} order${g.orders.length !== 1 ? 's' : ''}</div>
          ${labels}
        </div>`;
      }).join('');
    const html = `<!DOCTYPE html><html><head><style>${LABEL_STYLES}</style></head><body>${sections}</body></html>`;
    try { await Print.printAsync({ html }); }
    catch { Alert.alert('Print Error', 'Could not open print dialog.'); }
  };

  const handlePrintSummary = async () => {
    if (packingOrders.length === 0) {
      Alert.alert('No orders', 'No orders to print summary for.');
      return;
    }
    const rows = packingOrders.map((order: any) => {
      const addr = order.customer_addresses;
      const phone = addr?.phone_number || order.profiles?.phone_number || '—';
      const items = (order.order_items ?? [])
        .map((i: any) => `${i.item_name} ×${i.quantity}`)
        .join(', ');
      return `<tr>
        <td>#${order.id}</td>
        <td>${addr?.full_name ?? '—'}</td>
        <td>${addr?.address_line ?? '—'}${addr?.city ? ', ' + addr.city : ''}</td>
        <td>${phone}</td>
        <td>${items || '—'}</td>
      </tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><style>
      body{font-family:Arial,sans-serif;font-size:12px;padding:12px}
      h1{font-size:15px;margin-bottom:10px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
      th{background:#f0f0f0;font-weight:bold}
      tr:nth-child(even){background:#f9f9f9}
    </style></head><body>
      <h1>Order Summary &mdash; ${new Date().toLocaleDateString('en-IN')}</h1>
      <table>
        <thead><tr><th>Order</th><th>Name</th><th>Address</th><th>Phone</th><th>Items</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>`;
    try {
      await Print.printAsync({ html });
    } catch {
      Alert.alert('Print Error', 'Could not open print dialog.');
    }
  };

  // ── Kitchen row ──────────────────────────────
  const renderKitchenItem = ({ item }: { item: AggregateItem }) => {
    const canAct = item.status === 'Confirmed' || item.status === 'Preparing';
    return (
      <View style={styles.kitchenRow}>
        <ThemedText variant="body" color="primary" style={[{ flex: 1 }, styles.rowText]}>
          {item.item_name}
        </ThemedText>
        <ThemedText variant="body" color="subtitle" style={[styles.qty, styles.rowText]}>
          {item.unit
            ? `${item.total_quantity % 1 === 0 ? item.total_quantity : item.total_quantity.toFixed(1)}${item.unit}`
            : `× ${item.total_quantity}`}
        </ThemedText>
        <TouchableOpacity
          style={[styles.statusToggle, { borderColor: statusColor(item.status) }]}
          disabled={!canAct || updateStatus.isPending}
          onPress={() => {
            for (const id of item.order_ids) {
              updateStatus.mutate({ orderId: id, status: 'Ready' });
            }
          }}
        >
          <Text style={[styles.statusToggleText, { color: statusColor(item.status) }]}>
            {item.status}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ── Packing row ───────────────────
  // Delivery flow has moved to DriverDashboardScreen (drivers) and the
  // admin DeliveryManager Live tab. This row is Packing-only now.
  const renderOrderRow = ({ item }: { item: any }) => {
    const address = item.customer_addresses;
    const phone = address?.phone_number || item.profiles?.phone_number;
    const itemNames = (item.order_items ?? [])
      .map((oi: any) => `${oi.item_name} ×${oi.quantity}`)
      .join(', ');

    // BF-34b (F3.2): essentials skip Kitchen entirely (no Preparing/Ready
    // intermediate). They land in Packing at status='Confirmed' — the
    // Packing UI is their first-hop advance surface.
    let nextStatus: OrderStatus | null = null;
    if (item.status === 'Confirmed' && item.order_type === 'essential') nextStatus = 'Packed';
    else if (item.status === 'Ready') nextStatus = 'Packed';
    else if (item.status === 'Packed') nextStatus = 'Dispatched';

    const canAdvance = nextStatus !== null;

    return (
      <View style={styles.orderRow}>
        <View style={styles.orderRowMain}>
          <View style={{ flex: 1 }}>
            <ThemedText variant="subtitle" color="primary" style={styles.rowText}>#{item.id}</ThemedText>
            <ThemedText variant="small" color="subtitle" numberOfLines={2} style={styles.rowSmall}>
              {itemNames || '—'}
            </ThemedText>
            {address && (
              <ThemedText variant="small" color="muted" numberOfLines={1} style={styles.rowSmall}>
                {address.full_name}
              </ThemedText>
            )}
          </View>

          <View style={styles.orderRowRight}>
            <TouchableOpacity
              style={[styles.statusToggle, { borderColor: statusColor(item.status) }]}
              disabled={!canAdvance || !nextStatus || updateStatus.isPending}
              onPress={() => nextStatus && handleStatusUpdate(item.id, nextStatus)}
            >
              <Text style={[styles.statusToggleText, { color: statusColor(item.status) }]}>
                {item.status}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.orderRowIcons}>
          <TouchableOpacity style={styles.circleIcon} onPress={() => handleCall(phone)}>
            <Text style={styles.circleIconText}>☎</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.circleIcon}
            onPress={() => handlePrintOrderLabel(item)}
          >
            <Text style={styles.circleIconText}>⊟</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Delivery flow has moved out of the staff dashboard:
  //  - Drivers (staff with delivery_hubs/zones.driver_user_id) get
  //    DriverDashboardScreen via customer ProfilePopup → "My Deliveries"
  //  - Admin gets the live view via Manage → Delivery Manager → Live tab
  const TABS: StaffTab[] = ['Kitchen', 'Packing'];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Image source={{ uri: LOGO_URL }} style={styles.logo} resizeMode="contain" />
        <View style={styles.headerRight}>
          {pendingCount > 0 && (
            <View style={styles.queueBadge}>
              <ThemedText variant="micro" color="primary">{pendingCount} queued</ThemedText>
            </View>
          )}
          <TouchableOpacity style={styles.profileCircle} onPress={() => setProfileVisible(true)}>
            <Text style={styles.profileInitial}>{staffInitial}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Top tabs — pipe separated */}
      <View style={styles.topTabs}>
        {TABS.map((tab, idx) => (
          <React.Fragment key={tab}>
            {idx > 0 && <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>}
            <TouchableOpacity
              style={styles.topTab}
              onPress={() => setActiveTab(tab)}
            >
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

      {/* Admin note banners — below the tabs, single-line, centered, mild yellow.
          Falls back to legacy staff_message when no admin_notes exist. */}
      {tabNotes.length > 0
        ? tabNotes.map((n) => (
            <Text key={n.id} style={styles.noteLine} numberOfLines={1}>{n.note_text}</Text>
          ))
        : !!legacyStaffMessage && (
            <Text style={styles.noteLine} numberOfLines={1}>{legacyStaffMessage}</Text>
          )
      }

      {/* Packing sub-tabs */}
      {activeTab === 'Packing' && (
        <View style={styles.subTabs}>
          {(['Food', 'Essentials'] as PackingSubTab[]).map((sub) => (
            <TouchableOpacity
              key={sub}
              style={[styles.subTab, packingSubTab === sub && styles.subTabActive]}
              onPress={() => setPackingSubTab(sub)}
            >
              <ThemedText
                variant="body"
                color={packingSubTab === sub ? 'primary' : 'muted'}
                style={packingSubTab === sub ? styles.subTabTextActive : undefined}
              >
                {sub}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Content */}
      {isError ? (
        <ErrorRetry message="Failed to load orders" onRetry={refetch} />
      ) : activeTab === 'Kitchen' ? (
        <FlatList
          data={kitchenItems}
          keyExtractor={(item) => item.key}
          renderItem={renderKitchenItem}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Theme.colors.action.primary} />}
          ListEmptyComponent={!isLoading ? <EmptyState title="No items for kitchen" /> : null}
          contentContainerStyle={styles.list}
        />
      ) : (
        <FlatList
          data={packingOrders}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderOrderRow}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Theme.colors.action.primary} />}
          ListEmptyComponent={!isLoading ? <EmptyState title="No orders" /> : null}
          contentContainerStyle={styles.list}
        />
      )}

      {/* Floating "Mark all to next" bar — Kitchen */}
      {activeTab === 'Kitchen' && (
        <View style={styles.floatingBar}>
          <TouchableOpacity onPress={handleMarkAllKitchenReady}>
            <ThemedText variant="body" color="mint" style={styles.footerText}>
              Mark all as Ready  ›
            </ThemedText>
          </TouchableOpacity>
        </View>
      )}

      {/* Floating bar — Packing: Stationery (left) + Mark all as Packed (right) */}
      {activeTab === 'Packing' && (
        <View style={styles.floatingBarRow}>
          <TouchableOpacity onPress={() => setOrderFormType('Stationery')}>
            <ThemedText variant="body" color="mint" style={styles.footerText}>Stationery order  ›</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleMarkAllPacked}>
            <ThemedText variant="body" color="mint" style={styles.footerText}>Mark all as Packed  ›</ThemedText>
          </TouchableOpacity>
        </View>
      )}

      {/* Footer — Kitchen */}
      {activeTab === 'Kitchen' && (
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => setOrderFormType('Vegetables')}>
            <ThemedText variant="body" color="mint" style={styles.footerText}>Vegetables  ›</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setOrderFormType('Grocery')}>
            <ThemedText variant="body" color="mint" style={styles.footerText}>Grocery  ›</ThemedText>
          </TouchableOpacity>
        </View>
      )}

      {/* Footer — Packing */}
      {activeTab === 'Packing' && (
        <View style={styles.footer}>
          <TouchableOpacity onPress={handlePrintByDriver}>
            <ThemedText variant="body" color="mint" style={styles.footerText}>By Driver  ›</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={handlePrintByHub}>
            <ThemedText variant="body" color="mint" style={styles.footerText}>By Hub  ›</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={handlePrintSummary}>
            <ThemedText variant="body" color="mint" style={styles.footerText}>Summary  ›</ThemedText>
          </TouchableOpacity>
        </View>
      )}

      {/* Profile Popup */}
      <ProfilePopup
        visible={profileVisible}
        staffName={staffName}
        onClose={() => setProfileVisible(false)}
      />

      {/* Order Form Modal */}
      <OrderFormModal
        type={orderFormType}
        onClose={() => setOrderFormType(null)}
      />
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
  },
  logo: { width: 120, height: 88 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  queueBadge: {
    backgroundColor: Theme.colors.status.warning,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 8,
  },
  profileCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small,
    fontWeight: '600',
  },

  messageBanner: {
    backgroundColor: Theme.colors.background.secondary,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  noteLine: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 3,
    color: Theme.colors.status.warning,
    textAlign: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs + 2,
  },

  topTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: Theme.spacing.sm,
  },
  pipe: {
    marginHorizontal: Theme.spacing.sm,
    opacity: 0.4,
  },
  topTab: { paddingHorizontal: Theme.spacing.sm },
  tabText: {
    fontSize: Theme.typography.sizes.body + 4,
  },
  tabTextActive: {
    fontWeight: '600',
  },

  subTabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  subTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  subTabActive: { borderBottomColor: Theme.colors.text.mint },
  subTabTextActive: { fontWeight: '600' },

  list: { padding: Theme.spacing.md, paddingBottom: 90 },

  // Row text sizes +2pt
  rowText: { fontSize: BODY2 },
  rowSmall: { fontSize: SMALL2 },

  // Kitchen rows
  kitchenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  qty: { marginHorizontal: Theme.spacing.md },
  statusToggle: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 3,
    minWidth: 80,
    alignItems: 'center',
  },
  statusToggleText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: SMALL2,
  },

  // Packing / Delivery rows
  orderRow: {
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  orderRowMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  orderRowRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: Theme.spacing.sm,
  },
  orderRowIcons: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.xs,
  },
  circleIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleIconText: {
    fontSize: 13,
    color: Theme.colors.text.accent,
  },

  // Floating bar above footer
  floatingBar: {
    alignItems: 'flex-end',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
    backgroundColor: Theme.colors.background.primary,
  },
  floatingBarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
    backgroundColor: Theme.colors.background.primary,
  },

  // Footers
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.background.primary,
  },
  footerText: { fontSize: BODY2 },
});

// ── Order Form Modal styles ──────────────────────────────
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
    fontSize: 18,
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
    fontSize: 18,
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
    fontSize: 18,
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

// ── Profile popup styles ─────────────────────────────────
const popup = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Theme.colors.layout.overlayLightMid,
  },
  box: {
    position: 'absolute',
    right: Theme.spacing.md,
    width: 220,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  userSection: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  row: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  footerBtn: {
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
  },
  logoutText: {
    color: Theme.colors.status.error,
  },
});
