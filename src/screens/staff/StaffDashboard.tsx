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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import {
  useStaffOrders,
  useUpdateOrderStatus,
} from '../../hooks/useStaffOrders';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { useAuth } from '../../hooks/useAuth';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useWalletBalance } from '../../hooks/useWallet';
import { supabase } from '../../api/supabaseClient';
import { useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '../../types';

type StaffTab = 'Kitchen' | 'Packing' | 'Delivery';
type PackingSubTab = 'Food' | 'Essentials';
type OrderFormType = 'Vegetables' | 'Grocery' | 'Stationery' | null;

const LOGO_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/logo.png`;
const ROUTE_MAP_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/routemap.pdf`;

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
  total_quantity: number;
  status: OrderStatus;
  order_ids: number[];
}

function aggregateKitchenItems(orders: any[]): AggregateItem[] {
  const relevant = orders.filter((o) =>
    ['Confirmed', 'Preparing', 'Ready'].includes(o.status)
  );
  const map = new Map<string, AggregateItem>();
  for (const order of relevant) {
    for (const oi of order.order_items ?? []) {
      const key = `${oi.item_name}_${order.status}`;
      const existing = map.get(key);
      if (existing) {
        existing.total_quantity += oi.quantity;
        existing.order_ids.push(order.id);
      } else {
        map.set(key, {
          key,
          item_name: oi.item_name,
          total_quantity: oi.quantity,
          status: order.status,
          order_ids: [order.id],
        });
      }
    }
  }
  const order = ['Confirmed', 'Preparing', 'Ready'];
  return Array.from(map.values()).sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status)
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

  // Suggestions: catalog items starting with the typed letter(s), not yet added
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
  };

  const addCustom = () => {
    const name = search.trim();
    if (!name) return;
    setSearch('');
    setLineItems((prev) => [...prev, { id: `custom_${Date.now()}`, name, qty: 1 }]);
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
      await supabase.from('staff_order_requests').insert({
        request_type: type,
        items: lineItems.map((i) => ({ name: i.name, qty: i.qty })),
        status: 'Pending',
        submitted_by: session?.user.id ?? null,
      });
      Alert.alert('Submitted', `${type} order sent to admin for approval.`);
      onClose();
    } catch {
      Alert.alert('Error', 'Failed to submit. Try again.');
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

      <View style={formModal.sheet}>
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

        {/* Suggestions */}
        {showSuggestions && (
          <View style={formModal.suggestions}>
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
          </View>
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

  const handleSignOut = () => {
    onClose();
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
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
          <ThemedText variant="body" color="primary">Clock In / Clock Out</ThemedText>
        </TouchableOpacity>
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
  const essentialsActive = useFeatureFlag('essentials_module_active');
  const { data: staffMessage } = useStaffMessage();

  useRealtimeOrders(true);

  const staffName = profile?.fullName || (session?.user.phone ? `...${session.user.phone.slice(-4)}` : 'Staff');
  const staffInitial = (profile?.fullName?.[0] ?? 'S').toUpperCase();

  // ── Order filters ────────────────────────────
  const kitchenOrders = useMemo(
    () => (orders ?? []).filter((o) => ['Confirmed', 'Preparing', 'Ready'].includes(o.status) && o.order_type === 'food'),
    [orders]
  );

  const packingOrders = useMemo(
    () => (orders ?? []).filter((o) => {
      const inStatus = ['Ready', 'Packed', 'Dispatched'].includes(o.status);
      return packingSubTab === 'Food'
        ? inStatus && o.order_type === 'food'
        : inStatus && o.order_type === 'essential';
    }),
    [orders, packingSubTab]
  );

  const deliveryOrders = useMemo(
    () => (orders ?? []).filter((o) => ['Dispatched', 'On the Way', 'Delivered'].includes(o.status)),
    [orders]
  );

  const kitchenItems = useMemo(() => aggregateKitchenItems(kitchenOrders), [kitchenOrders]);

  // ── Handlers ─────────────────────────────────
  const handleStatusUpdate = useCallback((orderId: number, next: OrderStatus) => {
    updateStatus.mutate({ orderId, status: next });
  }, [updateStatus]);

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
            updateStatus.mutate({ orderId: o.id, status: 'Ready' });
          }
        },
      },
    ]);
  }, [orders, updateStatus]);

  const handleMarkAllPacked = useCallback(() => {
    const toMark = packingOrders.filter((o) => o.status === 'Ready');
    if (toMark.length === 0) return;
    Alert.alert('Mark All as Packed', `Mark ${toMark.length} order(s) as Packed?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Packed',
        onPress: () => {
          for (const o of toMark) {
            updateStatus.mutate({ orderId: o.id, status: 'Packed' });
          }
        },
      },
    ]);
  }, [packingOrders, updateStatus]);

  const handleCall = (phone?: string) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`);
  };

  const handleMap = (address?: any) => {
    if (!address) return;
    const q = encodeURIComponent(`${address.address_line ?? ''} ${address.city ?? ''}`);
    Linking.openURL(`https://maps.apple.com/?q=${q}`);
  };

  const handleRouteMap = () => {
    // Opens in system browser until expo-web-browser is installed for in-app PDF viewing
    Linking.openURL(ROUTE_MAP_URL);
  };

  // ── Kitchen row ──────────────────────────────
  const renderKitchenItem = ({ item }: { item: AggregateItem }) => {
    const isReady = item.status === 'Ready';
    return (
      <View style={styles.kitchenRow}>
        <ThemedText variant="body" color="primary" style={[{ flex: 1 }, styles.rowText]}>
          {item.item_name}
        </ThemedText>
        <ThemedText variant="body" color="subtitle" style={[styles.qty, styles.rowText]}>
          × {item.total_quantity}
        </ThemedText>
        <TouchableOpacity
          style={[styles.statusToggle, { borderColor: isReady ? Theme.colors.status.success : Theme.colors.status.info }]}
          disabled={isReady || updateStatus.isPending}
          onPress={() => {
            for (const id of item.order_ids) {
              updateStatus.mutate({ orderId: id, status: 'Ready' });
            }
          }}
        >
          <Text style={[styles.statusToggleText, { color: isReady ? Theme.colors.status.success : Theme.colors.status.info }]}>
            {isReady ? 'Ready' : 'Confirmed'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ── Packing / Delivery row ───────────────────
  const renderOrderRow = ({ item }: { item: any }) => {
    const address = item.customer_addresses;
    const phone = address?.phone_number || item.profiles?.phone_number;
    const itemNames = (item.order_items ?? [])
      .map((oi: any) => `${oi.item_name} ×${oi.quantity}`)
      .join(', ');

    let nextStatus: OrderStatus | null = null;
    if (activeTab === 'Packing') {
      if (item.status === 'Ready') nextStatus = 'Packed';
      else if (item.status === 'Packed') nextStatus = 'Dispatched';
    } else if (activeTab === 'Delivery') {
      if (item.status === 'Dispatched') nextStatus = 'On the Way';
      else if (item.status === 'On the Way') nextStatus = 'Delivered';
    }

    const canAdvance = activeTab === 'Packing'
      ? item.status === 'Ready' || item.status === 'Packed'
      : item.status === 'Dispatched' || item.status === 'On the Way';

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
          {activeTab === 'Delivery' && (
            <>
              <TouchableOpacity style={styles.circleIcon} onPress={() => handleMap(address)}>
                <Text style={styles.circleIconText}>⊙</Text>
              </TouchableOpacity>
              {address && (
                <TouchableOpacity
                  style={styles.circleIcon}
                  onPress={() => Alert.alert('Address', `${address.full_name}\n${address.address_line}${address.landmark ? '\n' + address.landmark : ''}${address.city ? '\n' + address.city : ''}`)}
                >
                  <Text style={styles.circleIconText}>⊞</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          {activeTab === 'Packing' && (
            <TouchableOpacity
              style={styles.circleIcon}
              onPress={() => Alert.alert('Print Label', `Label for Order #${item.id}\n${address?.full_name ?? ''}\n${address?.address_line ?? ''}`)}
            >
              <Text style={styles.circleIconText}>⊟</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const TABS: StaffTab[] = ['Kitchen', 'Packing', 'Delivery'];

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

      {/* Staff message bar */}
      {!!staffMessage && (
        <View style={styles.messageBanner}>
          <ThemedText variant="small" color="primary">{staffMessage}</ThemedText>
        </View>
      )}

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

      {/* Packing sub-tabs */}
      {activeTab === 'Packing' && (
        <View style={styles.subTabs}>
          {(['Food', ...(essentialsActive ? ['Essentials'] : [])] as PackingSubTab[]).map((sub) => (
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
          data={activeTab === 'Packing' ? packingOrders : deliveryOrders}
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
          <TouchableOpacity onPress={() => Alert.alert('Print All Labels', 'Label preview will open here.')}>
            <ThemedText variant="body" color="mint" style={styles.footerText}>Print all labels  ›</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Alert.alert('Print Summary', 'Order summary with address & phone preview will open here.')}>
            <ThemedText variant="body" color="mint" style={styles.footerText}>Print summary  ›</ThemedText>
          </TouchableOpacity>
        </View>
      )}

      {/* Footer — Delivery */}
      {activeTab === 'Delivery' && (
        <View style={styles.footer}>
          <View />
          <TouchableOpacity onPress={handleRouteMap}>
            <ThemedText variant="body" color="mint" style={styles.footerText}>Route Map  ›</ThemedText>
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
  logo: { width: 60, height: 44 },
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
  footerColumn: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.background.primary,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.xs,
  },
  footerDivider: {
    height: Theme.spacing.md,
  },
  footerText: { fontSize: BODY2 },
});

// ── Order Form Modal styles ──────────────────────────────
const formModal = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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
    backgroundColor: 'rgba(0,0,0,0.45)',
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
