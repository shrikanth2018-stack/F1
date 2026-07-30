/**
 * 1stOne F1 — Vendor Dashboard ("My Store")
 *
 * The approved vendor's own surface, reached from their profile menu —
 * the same arrangement a hub operator has, because a vendor is likewise a
 * customer-role profile.
 *
 *   Supply    what to bring and when. Paid orders only, so nobody sources
 *             goods for a sale that may never happen.
 *   Items     their catalogue: price, daily cap, on/off.
 *   Earnings  what each sale paid them, the balance, and the payout claim.
 *
 * Nothing here computes money. Earnings come from vendor_earnings, written
 * by the credit-on-delivery trigger, and the claim amount is decided by the
 * server — this screen only ever renders figures it was given.
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { SegmentedControl } from '../../components/SegmentedControl';
import { DispatchBadge } from '../../components/DispatchBadge';
import { infoDialog, confirmDialog } from '../../utils/confirmDialog';
import { formatPriceShort, formatDateShort, getErrorMessage } from '../../utils/formatters';
import { istTimeLabel } from '../../utils/istDate';
// A vendor only ever sells essentials, so every cycle they see must be named
// the way the customer sees it on the Essentials menu — Morning, not
// Breakfast. The order rows get this from the server; the picker here has the
// full cycle row, so it uses the shared helper.
import { essentialsCycleLabel } from '../../utils/cycleLabels';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useWalletBalance } from '../../hooks/useWallet';
import { useVendorZones } from '../../hooks/useVendors';
import {
  useMyVendor,
  useMyVendorItems,
  useSaveVendorItem,
  useToggleVendorItem,
  useVendorOrders,
  useMarkOrderReady,
  useMyVendorEarnings,
  useMyVendorPayouts,
  useClaimVendorPayout,
  type VendorItem,
  type VendorOrder,
} from '../../hooks/useMyVendor';
import type { CustomerScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type Tab = 'Supply' | 'Items' | 'Earnings';

export function VendorDashboardScreen({ navigation }: CustomerScreenProps<'VendorDashboard'>) {
  const [tab, setTab] = useState<Tab>('Supply');
  const { data: vendor, isLoading } = useMyVendor();
  const vendorId = vendor?.id;

  const orders = useVendorOrders(!!vendorId && vendor?.status === 'approved');
  const markReady = useMarkOrderReady();
  const items = useMyVendorItems(vendorId);
  const earnings = useMyVendorEarnings(vendorId);
  const payouts = useMyVendorPayouts();
  const { data: wallet } = useWalletBalance();
  // Only cycles flagged is_essentials can ever render on the customer's
  // Essentials page — HomeScreen builds its sections from that list and
  // buildSections silently DROPS any item whose cycle isn't in it. Offering
  // the full cycle list here let a vendor file an item under Snacks, where it
  // was fetched and then thrown away with nothing said to anyone.
  const { data: allCycles = [] } = useDeliveryCycles();
  const cycles = allCycles.filter((c) => c.is_essentials);
  // Where this vendor's goods actually reach. Admin-granted, never the
  // vendor's to choose — but they must be able to SEE it, because an item
  // with no area is invisible to every customer and looks identical to one
  // that is selling fine.
  const { data: sellingAreas = [] } = useVendorZones(vendorId);

  const saveItem = useSaveVendorItem();
  const toggleItem = useToggleVendorItem();
  const claim = useClaimVendorPayout();

  // New-item form
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('');
  const [cap, setCap] = useState('');
  const [cycleIdx, setCycleIdx] = useState(0);

  if (isLoading || !vendor) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
      </SafeAreaView>
    );
  }

  const suspended = vendor.status === 'suspended';
  const selectedCycle = cycles[cycleIdx];

  const handleAddItem = async () => {
    if (!name.trim()) { infoDialog('Name required', 'What is this item called?'); return; }
    const p = parseFloat(price);
    if (!Number.isFinite(p) || p <= 0) { infoDialog('Price required', 'Enter the selling price.'); return; }
    if (!selectedCycle) { infoDialog('No delivery cycle', 'No cycles are available.'); return; }
    try {
      await saveItem.mutateAsync({
        vendorId: vendor.id,
        branchId: vendor.branch_id,
        name: name.trim(),
        price: p,
        unit: unit.trim() || 'unit',
        cycleId: selectedCycle.id,
        dailyCap: cap.trim() ? parseInt(cap, 10) : null,
      });
      setName(''); setPrice(''); setUnit(''); setCap('');
    } catch (e) {
      infoDialog('Could not save', getErrorMessage(e));
    }
  };

  const handleClaim = async () => {
    const balance = wallet?.balance ?? 0;
    const ok = await confirmDialog({
      title: `Request ${formatPriceShort(balance)}?`,
      message: 'This goes to the team for approval and payment.',
      confirmLabel: 'Request payout',
    });
    if (!ok) return;
    try {
      const res = await claim.mutateAsync();
      infoDialog('Payout requested', `${formatPriceShort(res.amount)} is with the team for approval.`);
    } catch (e) {
      infoDialog('Could not request', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title} numberOfLines={1}>
          {vendor.business_name || 'My Store'}
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      {suspended && (
        <ThemedText variant="small" color="muted" style={styles.banner}>
          Your store is paused. Orders already placed will still be delivered and any
          balance is still yours to claim.
        </ThemedText>
      )}

      <SegmentedControl
        style={styles.tabs}
        value={tab}
        onChange={setTab}
        options={[
          { key: 'Supply', label: 'Orders' },
          { key: 'Items', label: 'Items' },
          { key: 'Earnings', label: 'Earnings' },
        ]}
      />

      {/* ── Orders — what to make ready, like the hub operator's list ── */}
      {tab === 'Supply' && (
        <FlatList
          data={orders.data ?? []}
          keyExtractor={(o: VendorOrder) => String(o.order_id)}
          ItemSeparatorComponent={() => <Divider />}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <ThemedText variant="small" color="muted" style={styles.hint}>
              Paid orders only, shown as they come in. Each one says whether the
              customer can still cancel it — buy stock once it reads confirmed.
            </ThemedText>
          }
          // A failed RPC used to render as "No orders yet", which is exactly
          // how the broken return type stayed hidden. An error must look like
          // an error.
          ListEmptyComponent={
            orders.error
              ? <ErrorRetry message="Could not load your orders" onRetry={orders.refetch} />
              : !orders.isLoading ? <EmptyState title="No orders yet" /> : null
          }
          renderItem={({ item }) => {
            const isReady = !!item.ready_at;
            // The vendor sees orders live, well before the kitchen push, so
            // they have real lead time to procure. The flip side is that an
            // order is provisional until the cancellation window shuts, and
            // stock bought against one that is then cancelled is the vendor's
            // loss. `cancellable_until` is the same instant cancel-order
            // enforces, so this note is not an estimate.
            const lockAt = item.cancellable_until ? new Date(item.cancellable_until) : null;
            const stillCancellable = !!lockAt && lockAt.getTime() > Date.now();
            return (
              <View style={styles.orderRow}>
                <View style={styles.rowTop}>
                  <ThemedText variant="body" color="primary" style={styles.txt}>
                    #{item.order_id}
                  </ThemedText>
                  <ThemedText variant="small" color="muted" style={[styles.sub, styles.flex1]}>
                    {formatDateShort(item.dispatch_date)}
                    {item.cycle_name ? ` · ${item.cycle_name}` : ''}
                  </ThemedText>
                  {isReady && <DispatchBadge label="Ready" variant="success" />}
                </View>

                {(item.items ?? []).map((line, i) => (
                  <ThemedText key={i} variant="body" color="subtitle" style={styles.line}>
                    {line.item_name}  ×{line.quantity}
                  </ThemedText>
                ))}

                <ThemedText
                  variant="small"
                  color={stillCancellable ? 'warning' : 'mint'}
                  style={styles.sub}
                >
                  {stillCancellable
                    ? `Can still be cancelled until ${istTimeLabel(lockAt!)}`
                    : 'Confirmed — safe to source'}
                </ThemedText>

                {/* Only populated for a vendor whose goods sit at the hub —
                    everyone else never receives these fields at all. */}
                {item.customer_name && (
                  <ThemedText variant="small" color="muted" style={styles.sub}>
                    {item.customer_name}{item.customer_phone ? ` · ${item.customer_phone}` : ''}
                  </ThemedText>
                )}

                <TouchableOpacity
                  onPress={() => markReady.mutate({ orderId: item.order_id, ready: !isReady })}
                  disabled={suspended}
                  style={styles.inlineAction}
                >
                  <ThemedText variant="body" color={isReady ? 'muted' : 'mint'} style={styles.txt}>
                    {isReady ? 'Undo ready' : 'Mark ready  ›'}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      {/* ── Items ── */}
      {tab === 'Items' && (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {/* Which customers can actually see these items. Without this an
              unlisted vendor sees a healthy-looking catalogue and no sales,
              with nothing anywhere explaining why. */}
          {sellingAreas.length === 0 ? (
            <ThemedText variant="small" color="warning" style={styles.hint}>
              Your items are not visible to any customer yet — we still need to set
              your delivery areas. Please get in touch and we will switch them on.
            </ThemedText>
          ) : (
            <ThemedText variant="small" color="muted" style={styles.hint}>
              Listed for customers in{' '}
              {sellingAreas
                .map((a) => a.delivery_hubs?.hub_name ?? a.delivery_zones?.zone_name ?? '—')
                .join(', ')}
              . Customers outside these areas will not see your items.
            </ThemedText>
          )}

          {(items.data ?? []).map((it: VendorItem) => (
            <View key={it.id} style={styles.row}>
              <View style={styles.flex1}>
                <ThemedText variant="body" color={it.is_active ? 'primary' : 'muted'} style={styles.txt}>
                  {it.name}
                </ThemedText>
                <ThemedText variant="small" color="muted" style={styles.sub}>
                  {formatPriceShort(it.price)}{it.unit ? ` / ${it.unit}` : ''}
                  {it.daily_cap ? ` · max ${it.daily_cap}/day` : ''}
                </ThemedText>
              </View>
              <Switch
                value={it.is_active}
                disabled={suspended}
                onValueChange={(v) => toggleItem.mutate({ id: it.id, isActive: v })}
                trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
                thumbColor={Theme.colors.text.primary}
              />
            </View>
          ))}
          {items.error ? (
            <ErrorRetry message="Could not load your items" onRetry={items.refetch} />
          ) : (items.data ?? []).length === 0 && !items.isLoading ? (
            <EmptyState title="No items yet" subtitle="Add your first one below" />
          ) : null}

          {!suspended && (
            <>
              <ThemedText variant="small" color="muted" style={styles.sectionLabel}>ADD AN ITEM</ThemedText>
              <TouchableOpacity
                style={styles.cycleRow}
                onPress={() => setCycleIdx((p) => (cycles.length ? (p + 1) % cycles.length : 0))}
                activeOpacity={0.7}
              >
                <ThemedText variant="body" color="mint" style={styles.txt}>
                  {selectedCycle ? essentialsCycleLabel(selectedCycle) : 'Loading…'}{'  ›'}
                </ThemedText>
              </TouchableOpacity>
              <TextInput style={styles.input} placeholder="Item name" placeholderTextColor={Theme.colors.text.muted} value={name} onChangeText={setName} />
              <View style={styles.row2}>
                <TextInput style={[styles.input, styles.flex1]} placeholder="Price ₹" placeholderTextColor={Theme.colors.text.muted} value={price} onChangeText={setPrice} keyboardType="numeric" />
                <TextInput style={[styles.input, styles.flex1]} placeholder="Unit (kg, litre)" placeholderTextColor={Theme.colors.text.muted} value={unit} onChangeText={setUnit} />
              </View>
              <TextInput style={styles.input} placeholder="Max per day (optional)" placeholderTextColor={Theme.colors.text.muted} value={cap} onChangeText={setCap} keyboardType="numeric" />
              <TouchableOpacity onPress={handleAddItem} disabled={saveItem.isPending} style={styles.inlineAction}>
                <ThemedText variant="body" color="mint" style={styles.txt}>
                  {saveItem.isPending ? 'Saving…' : 'Add item  ›'}
                </ThemedText>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}

      {/* ── Earnings ── */}
      {tab === 'Earnings' && (
        <ScrollView contentContainerStyle={styles.list}>
          <View style={styles.balanceBox}>
            <ThemedText variant="small" color="muted" style={styles.sub}>Available to claim</ThemedText>
            <ThemedText variant="header" color="mint">{formatPriceShort(wallet?.balance ?? 0)}</ThemedText>
          </View>
          <TouchableOpacity onPress={handleClaim} disabled={claim.isPending} style={styles.inlineAction}>
            <ThemedText variant="body" color="mint" style={styles.txt}>
              {claim.isPending ? 'Requesting…' : 'Request payout  ›'}
            </ThemedText>
          </TouchableOpacity>

          {(payouts.data ?? []).length > 0 && (
            <>
              <ThemedText variant="small" color="muted" style={styles.sectionLabel}>PAYOUT REQUESTS</ThemedText>
              {(payouts.data ?? []).map((p: any) => (
                <View key={p.id} style={styles.row}>
                  <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]}>
                    {formatPriceShort(p.amount)}
                  </ThemedText>
                  <DispatchBadge
                    label={p.status}
                    variant={p.status === 'Paid' ? 'success' : p.status === 'Rejected' ? 'error' : 'warning'}
                  />
                </View>
              ))}
            </>
          )}

          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>RECENT SALES</ThemedText>
          {earnings.error ? (
            <ErrorRetry message="Could not load your sales" onRetry={earnings.refetch} />
          ) : (earnings.data ?? []).length === 0 && !earnings.isLoading ? (
            <EmptyState title="No sales yet" />
          ) : null}
          {(earnings.data ?? []).map((e) => (
            <View key={e.id} style={styles.row}>
              <View style={styles.flex1}>
                <ThemedText variant="body" color="primary" style={styles.txt}>Order #{e.order_id}</ThemedText>
                <ThemedText variant="small" color="muted" style={styles.sub}>
                  {formatDateShort(e.created_at)} · sold {formatPriceShort(e.gross_amount)}
                  {e.commission_amount > 0 ? ` · less ${formatPriceShort(e.commission_amount)}` : ''}
                </ThemedText>
              </View>
              <ThemedText variant="body" color="mint" style={styles.txt}>
                {formatPriceShort(e.net_amount)}
              </ThemedText>
            </View>
          ))}
        </ScrollView>
      )}
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
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },
  loader: { marginTop: Theme.spacing.xl },
  banner: { fontSize: S, paddingHorizontal: Theme.spacing.md, paddingTop: Theme.spacing.xs },
  tabs: { marginHorizontal: Theme.spacing.md, marginVertical: Theme.spacing.sm },

  list: { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    gap: Theme.spacing.sm,
  },
  row2: { flexDirection: 'row', gap: Theme.spacing.sm },
  flex1: { flex: 1 },
  sub: { fontSize: S, marginTop: 2 },
  qty: { fontSize: B + 2 },
  orderRow: {
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  line: { fontSize: B, marginTop: 2 },
  hint: { fontSize: S, marginBottom: Theme.spacing.xs },
  sectionLabel: { fontSize: S, letterSpacing: 1, marginTop: Theme.spacing.md, marginBottom: Theme.spacing.xs },

  cycleRow: {
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    alignSelf: 'flex-start',
    marginBottom: Theme.spacing.sm,
  },
  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  inlineAction: { paddingVertical: Theme.spacing.sm },

  balanceBox: { paddingVertical: Theme.spacing.md },

  txt: { fontSize: B },
});
