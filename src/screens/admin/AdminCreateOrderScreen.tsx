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

import React, { useState, useMemo, useEffect } from 'react';
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
import { ScreenHeader } from '../../components/ScreenHeader';
import { FooterAction, FOOTER_CLEARANCE } from '../../components/FooterAction';
import { useWizard, WizardProgress } from '../../components/Wizard';
import { infoDialog } from '../../utils/confirmDialog';
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
  type AdminOrderPreview,
} from '../../hooks/useAdminOrderEntry';
import type { MenuItem } from '../../types';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

/**
 * The order the questions are actually answered in — and the order the old
 * submit handler checked them in was almost the reverse, which is how an admin
 * with no customer selected came to be told about the delivery cycle.
 */
type Step = 'customer' | 'delivery' | 'items' | 'charges' | 'payment' | 'review';
const STEPS: Step[] = ['customer', 'delivery', 'items', 'charges', 'payment', 'review'];

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

  // ── The wizard ─────────────────────────────────────────────
  const wiz = useWizard<Step>(STEPS, navigation);

  /**
   * THE SERVER'S OWN FIGURES, ON A STEP RATHER THAN IN A DIALOG.
   *
   * This screen used to price the order and then read the answer out inside a
   * confirm dialog — six lines of money in a modal, because there was nowhere
   * else to put them. A review step is where they belong: it is scrollable,
   * it can be gone back from without losing the form, and the numbers sit
   * beside the choices that produced them.
   *
   * Priced by `admin-place-order` in preview mode — the same code path that
   * writes the order — so what is shown here cannot disagree with what gets
   * created.
   */
  const [quote, setQuote] = useState<AdminOrderPreview | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    if (wiz.step !== 'review') return;
    setQuote(null);
    setQuoteError(null);
    previewOrder
      .mutateAsync(buildPayload())
      .then(setQuote)
      .catch((e) => setQuoteError(getErrorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-price on entering review; buildPayload reads current state
  }, [wiz.step]);

  const walletBalance = found?.wallet_balance ?? 0;
  const shortfall = !!quote && paymentMode === 'wallet' && walletBalance < quote.total_amount;
  const badQty = picked.find((p) => !(parseInt(p.qty, 10) > 0));

  const handleCreate = async () => {
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
      //
      // `finish()` FIRST, and the order matters: `replace` removes this screen,
      // which fires the wizard's back guard. Without it the guard reads the
      // departure as a stray back press and steps to the previous question —
      // so the order is created and the admin is left staring at the payment
      // step of a form they have already submitted.
      wiz.finish();
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

  /**
   * The one button, and what it is for on this step.
   *
   * EVERY REFUSAL THIS SCREEN CAN MAKE NOW LIVES ON THE STEP THAT OWNS IT.
   * They were six checks at the top of one submit handler, fired after the
   * whole form was filled — and in an order that did not match the form, so an
   * admin who had not chosen a customer was told about the delivery cycle
   * first. `admin-place-order` still enforces all of them; this only decides
   * where they are met.
   */
  const footer = useMemo((): { label: string; onPress?: () => void } => {
    switch (wiz.step) {
      case 'customer':
        if (!isKnownCustomer) {
          return { label: phoneComplete ? 'No customer with this number' : "Enter the customer's phone" };
        }
        if (!targetAddress) return { label: 'This customer has no delivery address' };
        if (!addressRoutes) return { label: 'This address has no delivery area' };
        return { label: 'Next · delivery  ›', onPress: wiz.forward };
      case 'delivery':
        if (!selectedCycle) return { label: 'No delivery cycles are available' };
        return { label: 'Next · items  ›', onPress: wiz.forward };
      case 'items':
        if (picked.length === 0) return { label: 'Add at least one item' };
        if (badQty) return { label: `Enter how many ${badQty.name}` };
        return { label: 'Next · charges  ›', onPress: wiz.forward };
      case 'charges':
        return { label: 'Next · payment  ›', onPress: wiz.forward };
      case 'payment':
        return { label: 'Next · review  ›', onPress: wiz.forward };
      default:
        if (previewOrder.isPending || (!quote && !quoteError)) return { label: 'Pricing the order…' };
        if (!quote) return { label: 'Could not price this order' };
        return {
          label: `Create order · ${formatPriceShort(quote.total_amount)}  ›`,
          onPress: handleCreate,
        };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleCreate is stable enough; it reads current state on call
  }, [wiz.step, wiz.forward, isKnownCustomer, phoneComplete, targetAddress, addressRoutes,
      selectedCycle, picked.length, badQty, previewOrder.isPending, quote, quoteError]);

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Create Order" />

      <View style={styles.progress}>
        <WizardProgress count={STEPS.length} index={wiz.index} />
      </View>

      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ── 1. Customer ── */}
        {wiz.step === 'customer' && (<>
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

        </>)}

        {/* ── 2. Delivery cycle ── */}
        {wiz.step === 'delivery' && (<>
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

        </>)}

        {/* ── 3. Items ── */}
        {wiz.step === 'items' && (<>
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

        </>)}

        {/* ── 4. Charges ── */}
        {wiz.step === 'charges' && (<>
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

        </>)}

        {/* ── 5. Payment ── */}
        {wiz.step === 'payment' && (<>
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
        </>)}

        {/* ── 6. Review — the server's figures, not ours ── */}
        {wiz.step === 'review' && (<>
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>REVIEW</ThemedText>

        {!quote && !quoteError && (
          <ActivityIndicator color={Theme.colors.text.mint} style={styles.inlineLoader} />
        )}

        {quoteError && (
          <ThemedText variant="body" color="warning" style={styles.txt}>
            {quoteError}
          </ThemedText>
        )}

        {quote && (
          <>
            <View style={styles.row}>
              <ThemedText variant="body" color="muted" style={[styles.txt, styles.flex1]}>
                Items{quote.discount_percent > 0 ? `  (after ${quote.discount_percent}% off)` : ''}
              </ThemedText>
              <ThemedText variant="body" color="primary" style={styles.txt}>
                {formatPriceShort(quote.subtotal)}
              </ThemedText>
            </View>
            <View style={styles.row}>
              <ThemedText variant="body" color="muted" style={[styles.txt, styles.flex1]}>Delivery</ThemedText>
              <ThemedText variant="body" color="primary" style={styles.txt}>
                {quote.delivery_fee === 0 ? 'Free' : formatPriceShort(quote.delivery_fee)}
              </ThemedText>
            </View>
            <View style={styles.row}>
              <ThemedText variant="body" color="muted" style={[styles.txt, styles.flex1]}>Total</ThemedText>
              <ThemedText variant="body" color="mint" style={styles.txt}>
                {formatPriceShort(quote.total_amount)}
              </ThemedText>
            </View>
            <ThemedText variant="small" color="muted" style={styles.hint}>
              Incl. GST {formatPriceShort(quote.tax_amount)}
            </ThemedText>

            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>GOES OUT</ThemedText>
            <ThemedText variant="body" color="primary" style={styles.txt}>
              {quote.cycle_name} · {formatDateLong(quote.dispatch_date)}
            </ThemedText>
            {!!quote.dispatch_note && (
              <ThemedText variant="small" color="warning" style={styles.hint}>
                {quote.dispatch_note}
              </ThemedText>
            )}

            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>PAYMENT</ThemedText>
            <ThemedText variant="body" color="primary" style={styles.txt}>
              {PAYMENT_LABEL[paymentMode]}
            </ThemedText>
            {shortfall && (
              <ThemedText variant="small" color="warning" style={styles.hint}>
                {`\u26a0 Wallet has ${formatPriceShort(walletBalance)} \u2014 the order will be created unpaid.`}
              </ThemedText>
            )}
          </>
        )}
        </>)}
      </ScrollView>

      <FooterAction
        label={footer.label}
        onPress={footer.onPress}
        busy={createOrder.isPending}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  scroll: { paddingHorizontal: Theme.spacing.md, paddingBottom: FOOTER_CLEARANCE },
  progress: { paddingHorizontal: Theme.spacing.md, paddingTop: Theme.spacing.sm },

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
