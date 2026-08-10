/**
 * 1stOne F1 — Admin Running Orders Screen
 *
 * Single canonical admin view of orders for a given date. Each row shows
 * order # · zone-or-hub label · status pill. Tapping a row navigates to
 * AdminOrderDetailScreen for full context + actions (cancel, advance status,
 * call customer, open in Maps).
 *
 * Filter chips at top narrow by status; search box narrows by partial
 * order number. Both compose. Filters are component-lifetime only.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { DispatchBadge } from '../../components/DispatchBadge';
import { supabase } from '../../api/supabaseClient';
import { formatDateShort, formatPriceShort, getErrorMessage } from '../../utils/formatters';
import { orderStatusVariant } from '../../utils/orderStatus';
import { isUnsuccessfulDelivery } from '../../utils/orderFilters';
import { useAdminCancelOrder } from '../../hooks/useAdminOrders';
import { confirmDialog } from '../../utils/confirmDialog';
import { todayIST, istDateWithOffset } from '../../utils/istDate';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;


const STATUS_OPTIONS = [
  'All', 'Confirmed', 'Preparing', 'Ready', 'Packed',
  'Dispatched', 'Received at Hub', 'On the Way', 'Delivered', 'Cancelled',
] as const;
type StatusFilter = typeof STATUS_OPTIONS[number];

/**
 * UNDELIVERED ORDERS HAVE THEIR OWN TAB — they are not mixed into a day.
 *
 * They used to be pulled into whatever date the admin was looking at and
 * pinned to the top, so they followed you around until resolved. That kept
 * them visible but made every day's list a mixture of that day's work and a
 * backlog of unknown age, and it left them cluttering the live boards too.
 *
 * WHICH ORDERS BELONG HERE IS DECIDED BY THE SERVER, and has to be.
 *
 * This asked `dispatch_date < today`, which is not what undelivered means.
 * An order stranded when Lunch replaced Breakfast is dated TODAY, so it
 * failed that test — it had already left every live board and it could not
 * appear here either. On no screen at all until midnight, which is the exact
 * disappearance the one-batch rule exists to prevent. The
 * undelivered-batch push reported those orders correctly and then landed the
 * admin on an empty tab.
 *
 * admin_undelivered_order_ids() answers it from kitchen_push_log — the same
 * source the boards and vendor_orders() use — so the notification, this list
 * and the vendor's History cannot disagree about what happened to an order.
 */
function useUndeliveredOrders() {
  // Still keyed on the IST date: the answer changes at midnight even if
  // nothing else does, because a date passing is one of the two ways in.
  const today = todayIST();
  return useQuery({
    queryKey: ['admin_orders_undelivered', today],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: idRows, error: idErr } = await (supabase as any)
        .rpc('admin_undelivered_order_ids');
      if (idErr) throw idErr;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ids = (idRows ?? []).map((r: any) => r.order_id ?? r);
      if (ids.length === 0) return [];

      // The rows themselves still come from PostgREST, for the nested
      // address → hub/zone embed the row renders and an RPC would have to
      // flatten by hand. The RPC narrows WHICH orders; this selects what to
      // show for them.
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, status, delivery_method, dispatch_date, placed_by, user_id,
          total_amount, wallet_amount_used, payment_method, cycle_id,
          customer_addresses(
            delivery_hubs(hub_name),
            delivery_zones(zone_name)
          )
        `)
        .in('id', ids)
        .order('dispatch_date', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useOrdersForDate(date: string) {
  const today = todayIST();
  return useQuery({
    queryKey: ['admin_orders_manage', date, today],
    queryFn: async () => {
      // Row-level data only: id, status, dispatch_date, routing label.
      // Customer name, items, payment, full address load in
      // AdminOrderDetailScreen when admin taps a row.
      //
      // D2: also pull "unsuccessful delivery" orders — past-dated and still
      // not Delivered/Cancelled/Failed — regardless of the selected date.
      // They're an alert that must follow the admin until resolved.
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, status, delivery_method, dispatch_date, placed_by,
          customer_addresses(
            delivery_hubs(hub_name),
            delivery_zones(zone_name)
          )
        `)
        // The chosen day only. Past-dated unfinished orders belong to the
        // Undelivered tab now, not to every day the admin opens.
        .eq('dispatch_date', date)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

type AdminOrdersView = 'day' | 'undelivered';

export function AdminOrdersScreen({ navigation, route }: AdminScreenProps<'AdminOrders'>) {
  // Opens on the tab the caller asked for — the undelivered-batch push sends
  // `view: 'undelivered'`, so tapping it lands on the list it just described.
  const [view, setView] = useState<AdminOrdersView>(route.params?.view ?? 'day');
  const [dateOffset, setDateOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [searchTerm, setSearchTerm] = useState('');
  // Back-office orders carry placed_by (the admin who created them);
  // customer-placed orders leave it null.
  const [bulkOnly, setBulkOnly] = useState(false);
  const date = istDateWithOffset(dateOffset);

  const { data: dayOrders, isLoading: dayLoading, error, refetch } = useOrdersForDate(date);
  const { data: undelivered, isLoading: undLoading, refetch: refetchUnd } = useUndeliveredOrders();
  const { mutateAsync: adminCancel } = useAdminCancelOrder();
  const [busyId, setBusyId] = useState<number | null>(null);

  const isUndelivered = view === 'undelivered';
  const orders = isUndelivered ? undelivered : dayOrders;
  const isLoading = isUndelivered ? undLoading : dayLoading;

  /**
   * Cancel from the Undelivered tab.
   *
   * `refund` false credits nothing — for a card payment the money is returned
   * from the Razorpay dashboard instead, and crediting the wallet as well
   * would pay the customer twice. `refund` true credits the row's own total,
   * which is what a wallet-paid order needs.
   */
  const cancelUndelivered = useCallback(async (o: any, refund: boolean) => {
    const amount = refund ? Number(o.total_amount) || 0 : 0;
    const ok = await confirmDialog({
      title: refund ? 'Cancel and refund?' : 'Cancel without refund?',
      message: refund
        ? `Order #${o.id} will be cancelled and ${formatPriceShort(amount)} credited to the customer's wallet.`
        : `Order #${o.id} will be cancelled with NO wallet credit. Use this when the money goes back through Razorpay instead.`,
      confirmLabel: 'Cancel order',
      destructive: true,
    });
    if (!ok) return;
    setBusyId(o.id);
    try {
      await adminCancel({
        orderId: o.id,
        refundAmount: amount,
        userId: o.user_id,
        reason: 'Undelivered — cleared by admin',
      });
      refetchUnd();
    } catch (e) {
      Alert.alert('Could not cancel', getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  }, [adminCancel, refetchUnd]);

  const filteredOrders = useMemo(() => {
    const all = orders ?? [];
    const term = searchTerm.trim();

    /**
     * SEARCH BY ANY NUMBER IN A PURCHASE, GET THE WHOLE PURCHASE.
     *
     * One checkout is now several rows — a food row and an essentials row per
     * cycle — each with its own id. The customer only ever sees the lowest
     * one, and the printed slip carries them all. Matching ids alone meant
     * searching the number a customer quoted returned one row and left its
     * siblings looking like unrelated orders.
     *
     * So: find the rows whose id matches, then widen to every row sharing
     * their order group.
     */
    const groupsMatched = term
      ? new Set(
          all
            .filter((o) => String(o.id).includes(term))
            .map((o) => (o as any).order_group_id)
            .filter(Boolean),
        )
      : null;

    const filtered = all.filter((o) => {
      if (statusFilter !== 'All' && o.status !== statusFilter) return false;
      if (term) {
        const idHit = String(o.id).includes(term);
        const groupHit = groupsMatched?.has((o as any).order_group_id) ?? false;
        if (!idHit && !groupHit) return false;
      }
      if (bulkOnly && !(o as any).placed_by) return false;
      return true;
    });
    // The Undelivered tab is already nothing but these, and it is sorted
    // oldest-first by the query — the longest-waiting needs attention most.
    if (isUndelivered) return filtered;
    return [...filtered].sort(
      (a, b) =>
        (isUnsuccessfulDelivery(a) ? 0 : 1) - (isUnsuccessfulDelivery(b) ? 0 : 1)
    );
  }, [orders, statusFilter, searchTerm, bulkOnly, isUndelivered]);

  if (error) return <ErrorRetry message="Could not load orders" onRetry={refetch} />;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Running Orders</ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      {/* Dates apply to the day view only — the Undelivered set spans every
          date and paging through days there would mean nothing. */}
      {!isUndelivered && (
      <View style={styles.dateRow}>
        <TouchableOpacity onPress={() => setDateOffset((d) => d - 1)} style={styles.dateArrow} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}>
          <ThemedText style={styles.arrowText} color="mint">‹</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="body" color="primary" style={styles.dateLabel}>{formatDateShort(date)}</ThemedText>
        <TouchableOpacity onPress={() => setDateOffset((d) => d + 1)} style={styles.dateArrow} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}>
          <ThemedText style={styles.arrowText} color="mint">›</ThemedText>
        </TouchableOpacity>
      </View>
      )}

      {/* Day | Undelivered. Undelivered is not a status filter — it is a
          different set entirely: everything past its dispatch date and still
          unfinished, of any age, regardless of which day is selected. */}
      <View style={styles.viewRow}>
        {(['day', 'undelivered'] as AdminOrdersView[]).map((v) => {
          const active = view === v;
          const count = v === 'undelivered' ? (undelivered?.length ?? 0) : null;
          return (
            <TouchableOpacity
              key={v}
              style={[styles.viewTab, active && styles.viewTabActive]}
              onPress={() => setView(v)}
              activeOpacity={0.7}
            >
              <ThemedText variant="small" color={active ? 'mint' : 'muted'}>
                {v === 'day' ? "Day's orders" : `Undelivered${count ? ` (${count})` : ''}`}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScrollView}
        contentContainerStyle={styles.chipRow}
      >
        {STATUS_OPTIONS.map((opt) => {
          const active = statusFilter === opt;
          return (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setStatusFilter(opt)}
              activeOpacity={0.7}
            >
              <ThemedText
                variant="small"
                color={active ? 'mint' : 'muted'}
                style={[styles.chipText, active && styles.chipTextActive]}
              >
                {opt}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Order # search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchTerm}
          onChangeText={setSearchTerm}
          placeholder="Search order #"
          placeholderTextColor={Theme.colors.text.muted}
          keyboardType="numeric"
          returnKeyType="search"
        />
        {searchTerm.length > 0 && (
          <TouchableOpacity onPress={() => setSearchTerm('')} style={styles.searchClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ThemedText variant="body" color="muted">×</ThemedText>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.chip, bulkOnly && styles.chipActive, styles.bulkChip]}
          onPress={() => setBulkOnly((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="switch"
          accessibilityState={{ checked: bulkOnly }}
        >
          <ThemedText variant="small" color={bulkOnly ? 'mint' : 'muted'} style={styles.chipText}>
            Bulk only
          </ThemedText>
        </TouchableOpacity>
      </View>

      <Divider />

      {isLoading && (
        <ActivityIndicator color={Theme.colors.action.primary} style={{ marginTop: Theme.spacing.xl }} />
      )}

      <FlatList
        data={filteredOrders}
        keyExtractor={(item: any) => item.id.toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={!isLoading ? <EmptyState title="No orders for this date" /> : null}
        ItemSeparatorComponent={() => <Divider />}
        renderItem={({ item }: { item: any }) => {
          // Routing label: hub takes precedence (more specific). Reads what's
          // actually populated on the address rather than trusting
          // order.delivery_method, which can be null/'direct' even when the
          // customer's address has a hub assigned.
          const addr = item.customer_addresses;
          const routingLabel =
            addr?.delivery_hubs?.hub_name
            || addr?.delivery_zones?.zone_name
            || 'Unassigned';
          const status = item.status ?? '';
          const unsuccessful = isUnsuccessfulDelivery(item);
          return (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.6}
              onPress={() => navigation.navigate('AdminOrderDetail', { orderId: item.id })}
            >
              <View style={styles.rowTop}>
                <ThemedText variant="body" color="primary" style={styles.rowId}>
                  #{item.id}
                </ThemedText>
                <ThemedText
                  variant="body"
                  color="subtitle"
                  numberOfLines={1}
                  style={styles.rowRouting}
                >
                  {routingLabel}
                </ThemedText>
                <DispatchBadge
                  label={status}
                  variant={orderStatusVariant(status)}
                />
              </View>
              {unsuccessful && !isUndelivered && (
                <ThemedText variant="small" color="muted" style={styles.unsuccessfulText}>
                  ⚠ UNSUCCESSFUL DELIVERY
                </ThemedText>
              )}

              {/* Undelivered tab: how old it is, and what can be done with it.
                  Two ways to cancel, because who owes the refund differs — a
                  wallet order is credited back here, a card order is returned
                  from the Razorpay dashboard and must NOT also be credited. */}
              {isUndelivered && (
                <>
                  <ThemedText variant="small" color="warning" style={styles.unsuccessfulText}>
                    Due {formatDateShort(item.dispatch_date)} · {item.payment_method === 'wallet' ? 'paid by wallet' : item.payment_method === 'razorpay' ? 'paid online' : 'unpaid'} · {formatPriceShort(Number(item.total_amount) || 0)}
                  </ThemedText>
                  {busyId === item.id ? (
                    <ActivityIndicator color={Theme.colors.status.error} size="small" style={styles.undActions} />
                  ) : (
                    <View style={styles.undActions}>
                      <TouchableOpacity onPress={() => cancelUndelivered(item, true)} activeOpacity={0.7}>
                        <ThemedText variant="small" color="mint">Cancel + refund</ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => cancelUndelivered(item, false)} activeOpacity={0.7}>
                        <ThemedText variant="small" color="muted">Cancel, no refund</ThemedText>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  viewRow: {
    flexDirection: 'row',
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.xs,
    gap: Theme.spacing.sm,
  },
  viewTab: {
    paddingVertical: 6,
    paddingHorizontal: Theme.spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
  },
  viewTabActive: {
    borderColor: `${Theme.colors.text.mint}80`,
    backgroundColor: `${Theme.colors.text.mint}1A`,
  },
  undActions: {
    flexDirection: 'row',
    gap: Theme.spacing.md,
    paddingTop: Theme.spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  title: { flex: 1, textAlign: 'center' },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
  },
  dateArrow: {
    paddingHorizontal: Theme.spacing.lg,
    paddingVertical: Theme.spacing.sm,
  },
  arrowText: {
    fontSize: 28,
    lineHeight: 32,
  },
  dateLabel: {
    minWidth: 140,
    textAlign: 'center',
  },
  list: { paddingBottom: Theme.spacing.xl },
  row: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 4,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  unsuccessfulText: {
    fontSize: S,
    color: Theme.colors.status.warning,
    letterSpacing: 0.5,
    marginTop: 4,
  },
  rowId: { fontSize: B, minWidth: 56 },
  rowRouting: { fontSize: S, flex: 1 },
  txt: { fontSize: B },

  chipScrollView: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  chipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },
  chipText: { fontSize: S - 1 },
  chipTextActive: {  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },
  searchInput: {
    flex: 1,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  searchClear: { paddingHorizontal: Theme.spacing.sm },
  bulkChip: { marginLeft: Theme.spacing.sm },
});
