/**
 * 1stOne F1 — Staff Dashboard
 *
 * Header: Logo + profile circle popup
 * Tabs: Kitchen  |  Packing  (pipe-separated, +4pt)
 * Admin note banners below the tabs, targeted per tab
 *
 * Kitchen: server-aggregated item list, Confirmed → Ready toggle
 *   Floating: Mark all as Ready ›
 *   Footer: Vegetables order  |  Grocery order
 *
 * Packing: Food / Essentials sub-tabs, order-level list
 *   Floating: Stationery order  |  Mark all as Packed ›
 *   Footer: By Driver  |  By Hub  |  Summary   (printed slips)
 *
 * There is NO Delivery tab here — it moved to DriverDashboardScreen and the
 * admin Delivery Manager, because delivery is a driver/hub-operator job and
 * those personas route through the customer navigator.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Image,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Linking,
  StyleSheet,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { printHtml } from '../../utils/printHtml';
import { Theme } from '../../theme';

const PACKING_ICONS = {
  call: require('../../../assets/icons/call.png'),
  print: require('../../../assets/icons/print.png'),
};
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { OrderFormModal, type OrderFormType } from './components/OrderFormModal';
import { ProfilePopup } from './components/ProfilePopup';
import {
  useStaffOrders,
  useUpdateOrderStatus,
  useBulkAdvanceStatus,
  useKitchenAggregate,
  type KitchenAggregateItem,
} from '../../hooks/useStaffOrders';
import { nextPackingStatus } from '../../utils/packingFlow';
import { isUnsuccessfulDelivery } from '../../utils/orderFilters';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { useAuth } from '../../hooks/useAuth';
import { useWalletBalance } from '../../hooks/useWallet';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { essentialsCycleLabel } from '../../utils/cycleLabels';
import { useStaffNoteForTab, type NoteTarget } from '../../hooks/useAdminNotes';
import { assetUrl } from '../../utils/assets';
import { formatDateShort as formatSlipDate } from '../../utils/formatters';
import type { OrderStatus } from '../../types';

type StaffTab = 'Kitchen' | 'Packing';
type PackingSubTab = 'Food' | 'Essentials';

const LOGO_URL = assetUrl('logo.png');

/** Trading name as printed on a customer's slip. Matches app.config.js `name`. */
const BRAND_NAME = '1stOne';

// ── Printed slip ─────────────────────────────────────────────
//
// One slip is both the bill and the delivery label: the customer needs the
// prices, the driver needs the address, and printing two pieces of paper per
// order for the same bag was never going to survive a busy morning.
//
// NOT a GST tax invoice, deliberately. 1stOne is not GST-registered yet, so
// the slip carries no GSTIN, no tax breakdown and does not call itself a tax
// invoice — printing any of those while unregistered would be a
// misrepresentation. `orders.tax_amount` is therefore ignored here, not
// forgotten. When registration happens this becomes a real invoice: add the
// GSTIN, an invoice number, the HSN code and the CGST/SGST split.

/** Escape anything that reaches the printed HTML — names and addresses are user text. */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** ₹ with Indian digit grouping. `&#8377;` rather than the glyph — print engines vary. */
function money(n: number): string {
  return `&#8377;${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
}

/**
 * What the customer owes, or doesn't.
 *
 * Deliberately does NOT read `paid_at`: until 2026-07-30 confirm-order won the
 * race against the webhook without stamping it, so every card order placed
 * before then has status 'Confirmed' and a null paid_at. Status is the reliable
 * signal — a Razorpay order only leaves 'Pending' once payment is confirmed.
 */
function paymentLine(order: any): string {
  if (order.subscription_id != null) return 'SUBSCRIPTION &middot; PREPAID';
  if (order.status === 'Pending') return 'PAYMENT PENDING';
  if (order.payment_method === 'wallet') return 'PAID &middot; Wallet';
  if (order.payment_method === 'razorpay') return 'PAID &middot; Online';
  return `TO COLLECT ${money(order.total_amount)}`;
}

const SLIP_STYLES = `
  body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#000}
  .section{page-break-after:always;padding:8px}
  .section:last-child{page-break-after:auto}
  .sectionTitle{font-size:15px;font-weight:bold;margin:4px 0 10px;padding:6px 10px;background:#000;color:#fff}
  .slip{page-break-inside:avoid;border:1.5px solid #000;padding:12px;margin:8px 0;max-width:420px}
  .biz{display:flex;justify-content:space-between;align-items:baseline}
  .bizName{font-size:17px;font-weight:bold}
  .ord{font-size:15px;font-weight:bold}
  .bizSub{font-size:11px;color:#333;margin:1px 0 0}
  .rule{border-top:1px solid #000;margin:8px 0}
  .who{font-size:13px;font-weight:bold}
  .when{font-size:11px;color:#333;float:right;font-weight:normal}
  .addr{font-size:12px;margin:2px 0}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-top:2px}
  td{padding:2px 0;vertical-align:top}
  .qty{text-align:right;white-space:nowrap;padding-left:8px;color:#333}
  .amt{text-align:right;white-space:nowrap;padding-left:10px}
  .totRow td{padding-top:4px}
  .grand td{font-size:14px;font-weight:bold;border-top:1px solid #000;padding-top:5px}
  .pay{margin-top:7px;font-size:12px;font-weight:bold;letter-spacing:.4px}
  .note{margin-top:6px;font-size:11px;font-style:italic}
`;

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

// Kitchen prep aggregation is server-derived — see useKitchenAggregate /
// the get_kitchen_aggregate RPC (audit D5).

// ── Staff message bar ────────────────────────────────────
// The legacy single `store_config.staff_message` fallback is GONE, and it had
// to be: that column does not exist on the table (verified against the live
// database 2026-07-30). The query 400'd on every staff dashboard load, React
// Query retried it twice, and because the result only fed an `||` fallback the
// failure was completely invisible. Admin notes (`useStaffNoteForTab`, which
// supports per-tab targeting) have been the real mechanism for some time.

// ── Main Dashboard ───────────────────────────────────────
export function StaffDashboard() {
  const [activeTab, setActiveTab] = useState<StaffTab>('Kitchen');
  const [packingSubTab, setPackingSubTab] = useState<PackingSubTab>('Food');
  const [profileVisible, setProfileVisible] = useState(false);
  const [orderFormType, setOrderFormType] = useState<OrderFormType>(null);

  const { session } = useAuth();
  const { data: profile } = useWalletBalance();
  const { data: orders, isLoading, isError, refetch } = useStaffOrders();
  const updateStatus = useUpdateOrderStatus();
  const bulkAdvance = useBulkAdvanceStatus();
  const { pendingCount } = useOfflineSync();

  // Active admin notes targeting the current tab (+ broadcasts targeting 'all')
  const tabKey: NoteTarget =
    activeTab === 'Kitchen' ? 'kitchen' :
    activeTab === 'Packing' ? 'packing' : 'all';
  const { data: tabNotes = [] } = useStaffNoteForTab(tabKey);

  useRealtimeOrders(true);

  // ── Printed-slip inputs ──────────────────────
  // The trading name is the app's own name, so it comes from the constant that
  // already names the app rather than from store_config — which has no
  // store_name, tagline or address column at all. Those become necessary the
  // day this slip has to carry a GSTIN and a registered address on it; today
  // the header is the name plus a number a customer can call.
  const { data: storeConfig } = useStoreConfig();
  const storeName = BRAND_NAME;
  const supportNumber = storeConfig?.whatsapp_support_number ?? '';
  const { data: cyclesForSlip = [] } = useDeliveryCycles();
  const cycleById = useMemo(
    () => new Map(cyclesForSlip.map((c) => [c.id, c])),
    [cyclesForSlip],
  );

  const staffName = profile?.fullName || (session?.user.phone ? `...${session.user.phone.slice(-4)}` : 'Staff');
  const staffInitial = (profile?.fullName?.[0] ?? 'S').toUpperCase();

  // ── Order filters ────────────────────────────
  // D2: an unsuccessful-delivery order is at the delivery stage (Dispatched
  // / On the Way) — it belongs to Hub + Driver, never Kitchen or Packing.
  const packingOrders = useMemo(
    () => (orders ?? []).filter((o) => {
      if (o.status === 'Cancelled') return false;
      if (isUnsuccessfulDelivery(o)) return false;
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

  // Kitchen prep list — aggregated server-side from the active batch (D5).
  const {
    data: kitchenItems = [],
    isLoading: kitchenLoading,
    refetch: refetchKitchen,
  } = useKitchenAggregate();

  // ── Handlers ─────────────────────────────────
  const handleStatusUpdate = useCallback((orderId: number, next: OrderStatus) => {
    const order = (orders ?? []).find((o) => o.id === orderId);
    updateStatus.mutate({ orderId, status: next, userId: order?.user_id });
  }, [updateStatus, orders]);

  /**
   * Mark all as Ready — over exactly what the board is showing.
   *
   * The ids come from the AGGREGATE, not from the batch. `useStaffOrders`
   * returns every order in the pushed cycle, essentials included, and this
   * used to sweep all of them: an essentials order — which never appears on
   * this board, and is packed without the kitchen touching it — was advanced
   * to Ready by a button the staffer had no way to know applied to it. 'Ready'
   * is one of the five statuses that push the CUSTOMER (orderStatusPush.ts),
   * so the result was a "your order is ready" for something nobody had made.
   *
   * get_kitchen_aggregate filters to `order_type = 'food'`, so taking the ids
   * from there makes the button and the list provably the same set.
   */
  const handleMarkAllKitchenReady = useCallback(() => {
    const ids = [...new Set(
      kitchenItems
        .filter((k) => k.status === 'Confirmed' || k.status === 'Preparing')
        .flatMap((k) => k.order_ids),
    )];
    if (ids.length === 0) return;
    Alert.alert('Mark All as Ready', `Mark ${ids.length} order(s) as Ready?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Ready',
        onPress: () => bulkAdvance.mutate({ orderIds: ids, status: 'Ready' }),
      },
    ]);
  }, [kitchenItems, bulkAdvance]);

  const handleMarkAllPacked = useCallback(() => {
    // BF-34b (F3.2): include 'Confirmed' essentials — they have no
    // 'Ready' intermediate and Packing is their first-hop surface.
    const toMark = packingOrders.filter(
      (o) => nextPackingStatus(o.status, o.order_type) === 'Packed',
    );
    if (toMark.length === 0) return;
    Alert.alert('Mark All as Packed', `Mark ${toMark.length} order(s) as Packed?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Packed',
        onPress: () =>
          bulkAdvance.mutate({ orderIds: toMark.map((o) => o.id), status: 'Packed' }),
      },
    ]);
  }, [packingOrders, bulkAdvance]);

  const handleCall = (phone?: string) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`);
  };

  // ── Print helpers (web + native, via utils/printHtml) ─────
  // Single order, printed from the row's print icon. Uses the same builder as
  // the batch prints below — a reprint must be identical to the original, not
  // a second version of the format that drifts from it.
  const handlePrintOrderLabel = async (item: any) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${SLIP_STYLES}</style></head>`
      + `<body><div class="section">${renderLabelBlock(item)}</div></body></html>`;
    try {
      await printHtml(html);
    } catch {
      Alert.alert('Print Error', 'Could not open print dialog.');
    }
  };

  /**
   * One order as a combined bill + delivery slip. Shared by every print path
   * (single order, by driver, by hub) so the paper the customer receives is
   * identical however it was produced.
   */
  const renderLabelBlock = (order: any) => {
    const addr = order.customer_addresses;
    const isSub = order.subscription_id != null;
    const lines = order.order_items ?? [];

    // A subscription dispatch is an operational instruction, not a sale — the
    // money was taken when the plan was bought (BF-19), so every one of these
    // rows is zero. Printing "₹0" next to real food reads as a mistake or a
    // freebie, so priced columns are dropped entirely for these.
    const rows = lines.length === 0
      ? `<tr><td>&mdash;</td></tr>`
      : lines.map((i: any) => {
          const qty = Number(i.quantity) || 0;
          const rate = Number(i.price_at_time) || 0;
          if (isSub) {
            return `<tr><td>${esc(i.item_name)}</td><td class="qty">&times;${qty}</td></tr>`;
          }
          return `<tr>
            <td>${esc(i.item_name)}</td>
            <td class="qty">${qty} &times; ${Math.round(rate)}</td>
            <td class="amt">${money(rate * qty)}</td>
          </tr>`;
        }).join('');

    const fee = Number(order.delivery_fee) || 0;
    const totals = isSub ? '' : `
      ${fee > 0 ? `<tr class="totRow"><td>Delivery</td><td class="qty"></td><td class="amt">${money(fee)}</td></tr>` : ''}
      <tr class="grand"><td>TOTAL</td><td class="qty"></td><td class="amt">${money(order.total_amount)}</td></tr>`;

    const cycle = cycleById.get(order.cycle_id);
    const cycleName = cycle
      ? (order.order_type === 'essential' ? essentialsCycleLabel(cycle) : cycle.cycle_name)
      : '';
    const when = [order.dispatch_date ? formatSlipDate(order.dispatch_date) : '', cycleName]
      .filter(Boolean).join(' &middot; ');

    return `<div class="slip">
      <div class="biz">
        <span class="bizName">${esc(storeName)}</span>
        <span class="ord">#${order.id}</span>
      </div>
      ${supportNumber ? `<p class="bizSub">${esc(supportNumber)}</p>` : ''}
      <div class="rule"></div>
      <div>
        <span class="when">${when}</span>
        <span class="who">${esc(addr?.full_name ?? '—')}</span>
      </div>
      <p class="addr">${esc(addr?.address_line ?? '—')}${addr?.landmark ? `, ${esc(addr.landmark)}` : ''}</p>
      ${addr?.city ? `<p class="addr">${esc(addr.city)}</p>` : ''}
      ${addr?.phone_number ? `<p class="addr">${esc(addr.phone_number)}</p>` : ''}
      <div class="rule"></div>
      <table>${rows}${totals}</table>
      <p class="pay">${paymentLine(order)}</p>
      ${order.notes ? `<p class="note">${esc(order.notes)}</p>` : ''}
    </div>`;
  };

  const LABEL_STYLES = SLIP_STYLES;

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
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${LABEL_STYLES}</style></head><body>${sections}</body></html>`;
    try { await printHtml(html); }
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
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${LABEL_STYLES}</style></head><body>${sections}</body></html>`;
    try { await printHtml(html); }
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
      await printHtml(html);
    } catch {
      Alert.alert('Print Error', 'Could not open print dialog.');
    }
  };

  // ── Kitchen row ──────────────────────────────
  const renderKitchenItem = ({ item }: { item: KitchenAggregateItem }) => {
    const canAct = item.status === 'Confirmed' || item.status === 'Preparing';
    return (
      <View style={styles.kitchenRow}>
        <ThemedText variant="body" color="primary" style={[{ flex: 1 }, styles.rowText]}>
          {item.item_name}
        </ThemedText>
        <ThemedText variant="body" color="subtitle" style={[styles.qty, styles.rowText]}>
          {item.unit
            ? `${item.total_quantity % 1 === 0 ? item.total_quantity : item.total_quantity.toFixed(1)} ${item.unit}`
            : `× ${item.total_quantity}`}
        </ThemedText>
        <TouchableOpacity
          style={[styles.statusToggle, { borderColor: statusColor(item.status) }]}
          disabled={!canAct || bulkAdvance.isPending}
          onPress={() => bulkAdvance.mutate({ orderIds: item.order_ids, status: 'Ready' })}
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

    const nextStatus = nextPackingStatus(item.status, item.order_type);
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
            <Image source={PACKING_ICONS.call} style={styles.circleIconImg} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.circleIcon}
            onPress={() => handlePrintOrderLabel(item)}
          >
            <Image source={PACKING_ICONS.print} style={styles.circleIconImg} />
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
          Targeted per tab via admin_notes; there is no longer a legacy
          store_config fallback (the column it read never existed). */}
      {tabNotes.map((n) => (
        <Text key={n.id} style={styles.noteLine} numberOfLines={1}>{n.note_text}</Text>
      ))}

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
          keyExtractor={(item) => `${item.item_name}__${item.unit}__${item.status}`}
          renderItem={renderKitchenItem}
          refreshControl={<RefreshControl refreshing={kitchenLoading} onRefresh={() => { refetch(); refetchKitchen(); }} tintColor={Theme.colors.action.primary} />}
          ListEmptyComponent={!kitchenLoading ? <EmptyState title="No items for kitchen" /> : null}
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
  subTabTextActive: {  },

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
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleIconImg: {
    width: 40,
    height: 40,
    resizeMode: 'contain',
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
