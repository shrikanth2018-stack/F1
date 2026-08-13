/**
 * 1stOne F1 — Create Order (back office / bulk)
 *
 * An admin places an order on behalf of an EXISTING customer, for ONE
 * delivery cycle. Registration lives on its own screen
 * (AdminCreateCustomerScreen) — the same division of labour the customer side
 * already uses, where Checkout picks an address and AddAddress creates one.
 * An unknown phone offers a hand-off that carries the number across and
 * returns here with the customer selected.
 *
 * Server-authoritative, same rule as customer checkout: this screen sends
 * item ids + quantities, a discount percentage, an optional delivery charge
 * and a dispatch INTENT. It never computes or sends a price or a date —
 * every figure shown after "Create order" comes back from
 * `admin-place-order`, which re-derives it through the same builder the
 * customer path uses.
 *
 * Items come only from the menu builder: the picker lists this cycle's
 * customer-facing menu items AND the priced building-block items behind
 * them, so "only chapati" or "only vada" is orderable without a separate
 * bulk catalog.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
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
import { confirmDialog, infoDialog } from '../../utils/confirmDialog';
import { formatPriceShort, formatDateLong, getErrorMessage } from '../../utils/formatters';
import { toMenuUnit } from '../../utils/menuRecipe';
import { useAllMenuItems, useAllDeliveryCycles } from '../../hooks/useMenuManagement';
import { useCycleDispatch } from '../../hooks/useCycleDispatch';
import {
  useCustomerByPhone,
  useCustomerAddresses,
  useCreateAdminOrder,
  useAdminOrderPreview,
  type AdminOrderPayload,
} from '../../hooks/useAdminOrderEntry';
import type { MenuItem } from '../../types';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type PaymentMode = 'wallet' | 'link' | 'account';
type PickedItem = { id: number; name: string; price: number; qty: string };

const PAYMENT_LABEL: Record<PaymentMode, string> = {
  account: 'On account — collect later',
  link: 'Payment link — Razorpay SMS',
  wallet: 'Customer wallet',
};

export function AdminCreateOrderScreen({ navigation }: AdminScreenProps<'AdminCreateOrder'>) {
  // ── Customer ──────────────────────────────────────────────
  // Lookup only. Registering a customer or fixing an address is the job of
  // AdminCreateCustomerScreen; this screen hands off and picks the result up
  // again when the query invalidates on return.
  const [phone, setPhone] = useState('');

  const { data: found, isFetching: lookingUp } = useCustomerByPhone(phone);
  const { data: addresses } = useCustomerAddresses(found?.id);

  const phoneComplete = phone.replace(/\D/g, '').length >= 10;
  const isKnownCustomer = !!found;

  // The address the server will use: default first, else the first active one.
  const targetAddress = (addresses ?? [])[0] as unknown as
    | {
        id: number;
        address_line: string;
        zone_id: number | null;
        hub_id: number | null;
        delivery_zones?: { zone_name: string } | null;
        delivery_hubs?: { hub_name: string } | null;
      }
    | undefined;

  // An address can be flagged serviceable yet carry no zone AND no hub — an
  // order built on it has no driver and shows "Unassigned" on the board. The
  // server refuses those; the screen surfaces it before the admin gets there.
  const addressRoutes =
    !!targetAddress && (targetAddress.zone_id != null || targetAddress.hub_id != null);
  const routingLabel = targetAddress?.delivery_hubs?.hub_name
    ? `Hub · ${targetAddress.delivery_hubs.hub_name}`
    : targetAddress?.delivery_zones?.zone_name
      ? `Zone · ${targetAddress.delivery_zones.zone_name}`
      : 'No delivery area set';
  const customerReady = isKnownCustomer && !!targetAddress && addressRoutes;

  // ── Cycle + items ─────────────────────────────────────────
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  const cycles = useMemo(() => rawCycles.filter((c: any) => c.is_active), [rawCycles]);
  const [cycleIdx, setCycleIdx] = useState(0);
  const selectedCycle = cycles[cycleIdx];

  const { data: dispatchMap } = useCycleDispatch();
  const nextRun = selectedCycle ? dispatchMap?.get(selectedCycle.id) : undefined;

  // The whole active catalogue, NOT just the chosen cycle. The cycle decides
  // WHEN this order is delivered; it does not limit what can go in it. A bulk
  // customer asking for 50 chapatis with lunch shouldn't be blocked because
  // chapati is catalogued under dinner — the server collapses every line into
  // the chosen cycle and derives the dispatch date from that cycle's cutoff.
  const { data: allInCycle = [] } = useAllMenuItems();
  const [picked, setPicked] = useState<PickedItem[]>([]);
  const [itemQuery, setItemQuery] = useState('');

  const availableItems = useMemo(
    () =>
      (allInCycle as MenuItem[]).filter(
        (m) => m.is_active && !picked.some((p) => p.id === m.id),
      ),
    [allInCycle, picked],
  );

  // Type-to-search rather than a wall of rows: name-contains (not just
  // starts-with) so "vada" finds "Idli Vada", capped so the list never
  // pushes the rest of the form off screen.
  const matchingItems = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    if (!q) return [];
    return availableItems.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [availableItems, itemQuery]);

  // Reference only — the server decides the real total.
  const totalUnits = useMemo(
    () => picked.reduce((n, p) => n + (parseInt(p.qty, 10) || 0), 0),
    [picked],
  );
  const itemsPreview = useMemo(
    () => picked.reduce((s, p) => s + p.price * (parseInt(p.qty, 10) || 0), 0),
    [picked],
  );

  // ── Order options ─────────────────────────────────────────
  const [useCurrentRun, setUseCurrentRun] = useState(false);
  const [discount, setDiscount] = useState('');
  const [feeOverride, setFeeOverride] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('account');
  const [notes, setNotes] = useState('');

  const createOrder = useCreateAdminOrder();
  const previewOrder = useAdminOrderPreview();

  const handleCycleToggle = () => {
    if (!cycles.length) return;
    // Items are cycle-tagged, so the selection cannot survive a cycle change.
    // Items are no longer cycle-bound, so the selection survives a cycle change.
    setCycleIdx((p) => (p + 1) % cycles.length);
  };

  /**
   * The one place the request body is assembled, so the preview and the real
   * call cannot drift apart — the figures shown in the confirmation dialog
   * are priced from exactly the body that then creates the order.
   * Only called after handleSubmit's guards have run.
   */
  const buildPayload = (): AdminOrderPayload => ({
    customer: { user_id: found!.id, address_id: targetAddress!.id },
    cycle_id: selectedCycle!.id,
    items: picked.map((p) => ({ item_id: p.id, quantity: parseInt(p.qty, 10) })),
    dispatch_target: useCurrentRun ? 'current_run' : 'auto',
    discount_percent: parseFloat(discount) || 0,
    delivery_fee_override: feeOverride.trim() === '' ? null : parseFloat(feeOverride),
    payment_mode: paymentMode,
    notes: notes.trim() || undefined,
  });

  const handleSubmit = async () => {
    if (!selectedCycle) {
      infoDialog('No cycle', 'No delivery cycles are available.');
      return;
    }
    if (picked.length === 0) {
      infoDialog('No items', 'Add at least one item to the order.');
      return;
    }
    const badQty = picked.find((p) => !(parseInt(p.qty, 10) > 0));
    if (badQty) {
      infoDialog('Quantity required', `Enter how many ${badQty.name}.`);
      return;
    }
    if (!isKnownCustomer) {
      infoDialog('Customer required', 'Find the customer by phone, or register them first.');
      return;
    }
    if (!targetAddress) {
      infoDialog('Address required', 'This customer has no delivery address. Add one first.');
      return;
    }
    if (!addressRoutes) {
      infoDialog(
        'Delivery area required',
        'This address has no zone or hub, so the order could not be routed. Fix the address first.',
      );
      return;
    }

    // Ask the server what it would charge — same code path that writes the
    // order, so the dialog cannot disagree with what gets created.
    let quote;
    try {
      quote = await previewOrder.mutateAsync(buildPayload());
    } catch (e) {
      infoDialog('Could not price the order', getErrorMessage(e));
      return;
    }

    const walletBalance = found?.wallet_balance ?? 0;
    const shortfall = paymentMode === 'wallet' && walletBalance < quote.total_amount;

    const ok = await confirmDialog({
      title: `Total ${formatPriceShort(quote.total_amount)}`,
      message: [
        `Items  ${formatPriceShort(quote.subtotal)}` +
          (quote.discount_percent > 0 ? `  (after ${quote.discount_percent}% off)` : ''),
        `Delivery  ${quote.delivery_fee === 0 ? 'Free' : formatPriceShort(quote.delivery_fee)}`,
        `Incl. GST ${formatPriceShort(quote.tax_amount)}`,
        '',
        `${quote.cycle_name} · ${formatDateLong(quote.dispatch_date)}`,
        `Payment: ${PAYMENT_LABEL[paymentMode]}`,
        ...(shortfall
          ? [`⚠ Wallet has ${formatPriceShort(walletBalance)} — the order will be created unpaid.`]
          : []),
        ...(quote.dispatch_note ? [quote.dispatch_note] : []),
      ].join('\n'),
      confirmLabel: 'Create order',
    });
    if (!ok) return;

    try {
      const res = await createOrder.mutateAsync(buildPayload());
      const lines = [
        `Order #${res.order_id}`,
        `Dispatch ${formatDateLong(res.dispatch_date)}`,
        `Total ${formatPriceShort(res.total_amount)}` +
          (res.discount_percent > 0 ? `  (after ${res.discount_percent}% off)` : ''),
        res.payment_state === 'paid'
          ? 'Paid from wallet.'
          : res.payment_state === 'link_sent'
            ? 'Payment link sent by SMS.'
            : 'Unpaid — on account.',
      ];

      // Landing on the order IS the confirmation — a modal that merely says
      // "created" adds a tap and, presented mid-transition, can be swallowed
      // entirely (which is what happened on the first run). `replace` keeps
      // Back going to the Manage list rather than into this now-stale form.
      navigation.replace('AdminOrderDetail', { orderId: res.order_id });

      // Only genuinely surprising outcomes get a dialog, and it fires after
      // the push animation so the modal is never presented mid-transition.
      const notes = [
        res.dispatch_note,
        res.payment_error ? `⚠ ${res.payment_error}` : null,
      ].filter(Boolean);
      if (notes.length > 0) {
        setTimeout(
          () => infoDialog(`Order #${res.order_id} created`, [...lines, ...notes].join('\n')),
          450,
        );
      }
    } catch (e) {
      infoDialog('Could not create order', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Create Order</ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ── Customer ── */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>CUSTOMER</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="Phone number (10 digits)"
          placeholderTextColor={Theme.colors.text.muted}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={13}
        />
        {lookingUp && <ActivityIndicator color={Theme.colors.text.mint} style={styles.inlineLoader} />}

        {isKnownCustomer && (
          <>
            <ThemedText variant="body" color="primary" style={styles.txt}>
              {found?.full_name || 'Unnamed customer'}
            </ThemedText>
            {targetAddress ? (
              <>
                <ThemedText variant="small" color="subtitle" style={styles.hint} numberOfLines={2}>
                  {targetAddress.address_line}
                </ThemedText>
                <View style={styles.routingRow}>
                  <ThemedText
                    variant="small"
                    color={addressRoutes ? 'mint' : 'muted'}
                    style={[styles.hint, styles.flex1]}
                  >
                    {routingLabel}
                  </ThemedText>
                  {!addressRoutes && (
                    <TouchableOpacity
                      onPress={() =>
                        navigation.navigate('AdminCreateCustomer', {
                          phone,
                          addressId: targetAddress.id,
                        })
                      }
                    >
                      <ThemedText variant="small" color="accent">Fix address  ›</ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            ) : (
              <View style={styles.routingRow}>
                <ThemedText variant="small" color="muted" style={[styles.hint, styles.flex1]}>
                  No delivery address on file.
                </ThemedText>
                <TouchableOpacity
                  onPress={() => navigation.navigate('AdminCreateCustomer', { phone })}
                >
                  <ThemedText variant="small" color="accent">Add address  ›</ThemedText>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {phoneComplete && !lookingUp && !isKnownCustomer && (
          <View style={styles.routingRow}>
            <ThemedText variant="small" color="muted" style={[styles.hint, styles.flex1]}>
              No customer with this number.
            </ThemedText>
            <TouchableOpacity onPress={() => navigation.navigate('AdminCreateCustomer', { phone })}>
              <ThemedText variant="small" color="accent">Create this customer  ›</ThemedText>
            </TouchableOpacity>
          </View>
        )}

        <Divider />

        {/* ── Cycle ── */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>DELIVERY CYCLE</ThemedText>
        <View style={styles.cycleLine}>
          <TouchableOpacity style={styles.cycleRow} onPress={handleCycleToggle} activeOpacity={0.7}>
            <ThemedText variant="body" color="mint" style={styles.txt}>
              {selectedCycle ? selectedCycle.cycle_name : 'Loading…'}{'  ›'}
            </ThemedText>
          </TouchableOpacity>
          <View style={styles.flex1} />
          <ThemedText variant="small" color="muted">Current run</ThemedText>
          <Switch
            value={useCurrentRun}
            onValueChange={setUseCurrentRun}
            trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
            thumbColor={Theme.colors.text.primary}
          />
        </View>
        <ThemedText variant="small" color="muted" style={styles.hint}>
          {nextRun ? `Next run ${formatDateLong(nextRun.dispatch_date)}. ` : ''}
          Current run only applies while that run&apos;s kitchen summary has not gone out.
        </ThemedText>

        <Divider />

        {/* ── Items ── */}
        {picked.length > 0 && (
          <>
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>ORDER</ThemedText>
            {picked.map((p) => (
              <View key={p.id} style={styles.row}>
                <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]} numberOfLines={1}>
                  {p.name}
                </ThemedText>
                <TextInput
                  style={styles.qtyInput}
                  value={p.qty}
                  onChangeText={(v) => setPicked((prev) => prev.map((x) => (x.id === p.id ? { ...x, qty: v } : x)))}
                  keyboardType="numeric"
                  placeholder="Qty"
                  placeholderTextColor={Theme.colors.text.muted}
                />
                <TouchableOpacity
                  onPress={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))}
                  hitSlop={{ top: 8, bottom: 8, left: 12, right: 4 }}
                >
                  <ThemedText variant="body" color="muted" style={styles.removeX}>×</ThemedText>
                </TouchableOpacity>
              </View>
            ))}
            <View style={[styles.row, styles.totalRow]}>
              <ThemedText variant="body" color="muted" style={[styles.txt, styles.flex1]}>
                {picked.length} item{picked.length === 1 ? '' : 's'} · {totalUnits} unit{totalUnits === 1 ? '' : 's'}
              </ThemedText>
              <ThemedText variant="body" color="mint" style={styles.txt}>
                {formatPriceShort(itemsPreview)}
              </ThemedText>
            </View>
            <ThemedText variant="small" color="muted" style={styles.hint}>
              Items only — the server adds delivery, applies the discount and carves out GST.
            </ThemedText>
          </>
        )}

        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>ADD ITEMS</ThemedText>
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, styles.flex1, styles.searchInput]}
            placeholder="Type to find an item or menu item"
            placeholderTextColor={Theme.colors.text.muted}
            value={itemQuery}
            onChangeText={setItemQuery}
            autoCorrect={false}
          />
          {itemQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setItemQuery('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <ThemedText variant="body" color="muted">×</ThemedText>
            </TouchableOpacity>
          )}
        </View>

        {itemQuery.trim().length === 0 ? (
          <ThemedText variant="small" color="muted" style={styles.hint}>
            {availableItems.length} items and menu items available.
          </ThemedText>
        ) : matchingItems.length === 0 ? (
          <ThemedText variant="small" color="muted" style={styles.hint}>
            Nothing matches &quot;{itemQuery.trim()}&quot;. Items are created in Menu Manager.
          </ThemedText>
        ) : (
          matchingItems.map((it) => (
            <TouchableOpacity
              key={it.id}
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => {
                setPicked((prev) => [...prev, { id: it.id, name: it.name, price: it.price, qty: '1' }]);
                setItemQuery('');
              }}
            >
              {/* An item's price is for a stated portion, so "₹20" alone says
                  nothing — ₹20 for how much? The portion is named here, where
                  the price is what someone is actually about to charge. A
                  menu is one of itself and needs no such line. */}
              <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]} numberOfLines={1}>
                {it.name}
                {!it.is_customer_visible && (
                  <ThemedText variant="small" color="muted">
                    {`  · item · ${Number(it.base_quantity ?? 1)} ${toMenuUnit(it.unit)} each`}
                  </ThemedText>
                )}
              </ThemedText>
              <ThemedText variant="body" color="subtitle" style={styles.txt}>₹{it.price}</ThemedText>
              <ThemedText variant="body" color="mint" style={styles.plus}>+</ThemedText>
            </TouchableOpacity>
          ))
        )}

        <Divider />

        {/* ── Money ── */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>DISCOUNT &amp; DELIVERY</ThemedText>
        <View style={styles.moneyRow}>
          <View style={styles.flex1}>
            <ThemedText variant="micro" color="muted">Discount % on items</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor={Theme.colors.text.muted}
              value={discount}
              onChangeText={setDiscount}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.flex1}>
            <ThemedText variant="micro" color="muted">Delivery charge ₹</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="Zone / hub rate"
              placeholderTextColor={Theme.colors.text.muted}
              value={feeOverride}
              onChangeText={setFeeOverride}
              keyboardType="numeric"
            />
          </View>
        </View>

        <Divider />

        {/* ── Payment ── */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>PAYMENT</ThemedText>
        {(['account', 'link', 'wallet'] as const).map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.option, paymentMode === mode && styles.optionActive]}
            onPress={() => setPaymentMode(mode)}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityState={{ selected: paymentMode === mode }}
          >
            <ThemedText variant="body" color="primary" style={styles.txt}>{PAYMENT_LABEL[mode]}</ThemedText>
            {mode === 'wallet' && (
              <ThemedText variant="small" color="muted">
                Balance {formatPriceShort(found?.wallet_balance ?? 0)}
              </ThemedText>
            )}
            {/* The device never computes the charge — only the server does.
                But when the ITEMS alone already exceed the balance the debit
                cannot possibly succeed, and saying so here beats finding out
                from an "order created unpaid" message afterwards. */}
            {mode === 'wallet' && itemsPreview > (found?.wallet_balance ?? 0) && (
              <ThemedText variant="small" color="subtitle">
                Items alone exceed the balance — the order would be created unpaid.
              </ThemedText>
            )}
          </TouchableOpacity>
        ))}

        <TextInput
          style={styles.input}
          placeholder="Notes for the kitchen / delivery (optional)"
          placeholderTextColor={Theme.colors.text.muted}
          value={notes}
          onChangeText={setNotes}
          multiline
        />
      </ScrollView>

      <TouchableOpacity
        style={styles.footer}
        onPress={handleSubmit}
        disabled={createOrder.isPending || !customerReady}
        activeOpacity={0.7}
      >
        {createOrder.isPending ? (
          <ActivityIndicator color={Theme.colors.text.mint} />
        ) : (
          <ThemedText variant="body" color={customerReady ? 'mint' : 'muted'} style={styles.txt}>
            Create order  ›
          </ThemedText>
        )}
      </TouchableOpacity>
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

  scroll: { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },

  sectionLabel: { fontSize: S, letterSpacing: 1, marginTop: Theme.spacing.md, marginBottom: Theme.spacing.xs },
  hint: { fontSize: S, marginTop: 2, marginBottom: Theme.spacing.xs },
  inlineLoader: { alignSelf: 'flex-start', marginVertical: Theme.spacing.xs },

  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },

  cycleRow: {
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    alignSelf: 'flex-start',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  flex1: { flex: 1 },
  qtyInput: {
    width: 72,
    textAlign: 'center',
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: 2,
  },
  removeX: { fontSize: B + 4, marginLeft: Theme.spacing.sm, color: Theme.colors.text.muted },
  plus: { fontSize: B + 4, marginLeft: Theme.spacing.md },

  routingRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  cycleLine: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  searchInput: { marginBottom: 0 },
  moneyRow: { flexDirection: 'row', gap: Theme.spacing.md },
  totalRow: { borderBottomWidth: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Theme.colors.text.mint },

  option: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionActive: { borderColor: Theme.colors.action.primary },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
    alignItems: 'center',
  },

  txt: { fontSize: B },
});
