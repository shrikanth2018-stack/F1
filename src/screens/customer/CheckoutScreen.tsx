/**
 * 1stOne F1 — Checkout Screen
 *
 * Server-authoritative: the screen sends only the cart (item ids + quantities)
 * and gets the binding price + dispatch dates from the `quote-order` endpoint
 * (`useOrderQuote`). It never computes cycles, dates, tax or fees. On Pay it
 * echoes that quote to `place-order`; if the server's fresh derivation has
 * drifted (a cutoff passed, a price changed) place-order returns 409 and the
 * screen re-quotes for the customer to re-confirm.
 *
 * Razorpay payments are confirmed via the confirm-order Edge Function; the
 * verify-payment webhook is a secondary safety net.
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  ScrollView,
  Alert,
  AppState,
  Platform,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Text,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import RazorpayCheckout from '../../utils/razorpay';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { Divider } from '../../components/Divider';
import { DispatchBadge } from '../../components/DispatchBadge';
import { useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../../utils/constants';
import { useCartStore } from '../../store/cartStore';
import { useEssentialsCartStore } from '../../store/essentialsCartStore';
import { useUIStore } from '../../store/uiStore';
import { useAddresses } from '../../hooks/useAddresses';
import { useWalletBalance } from '../../hooks/useWallet';
import { useSmartCart } from '../../hooks/useSmartCart';
import { useOrderQuote, type QuoteItemInput } from '../../hooks/useOrderQuote';
import { useAuth } from '../../hooks/useAuth';
import { formatPriceShort, formatDateLong } from '../../utils/formatters';
import { supabase } from '../../api/supabaseClient';
import { RAZORPAY_KEY_ID } from '../../utils/env';
import { trackOrderPlaced, trackOrderFailed } from '../../utils/analytics';
import { infoDialog, confirmDialog } from '../../utils/confirmDialog';
import { newIdempotencyKey } from '../../utils/idempotency';

type PaymentChoice = 'razorpay' | 'wallet';

export function CheckoutScreen({ navigation, route }: any) {
  const cartType: 'food' | 'essentials' = route?.params?.cartType ?? 'food';
  const subscriptionPlanId: number | undefined = route?.params?.subscriptionPlanId;
  const isSubscriptionOnly = subscriptionPlanId != null;
  const { session } = useAuth();

  const foodItems = useCartStore((s) => s.items);
  const foodPlans = useCartStore((s) => s.plans);
  const clearFood = useCartStore((s) => s.clearCart);
  const clearFoodPlans = useCartStore((s) => s.clearPlans);

  const essItems = useEssentialsCartStore((s) => s.items);
  const essPlans = useEssentialsCartStore((s) => s.plans);
  const clearEss = useEssentialsCartStore((s) => s.clearCart);
  const clearEssPlans = useEssentialsCartStore((s) => s.clearPlans);

  // In subscription-only mode, ignore items completely; only the one plan flows through.
  const subPlan = isSubscriptionOnly
    ? (foodPlans.find((p) => p.plan_id === subscriptionPlanId)
       ?? essPlans.find((p) => p.plan_id === subscriptionPlanId)
       ?? null)
    : null;

  const activeItems = isSubscriptionOnly ? [] : (cartType === 'food' ? foodItems : essItems);
  const activePlans = isSubscriptionOnly
    ? (subPlan ? [subPlan] : [])
    : (cartType === 'food' ? foodPlans : essPlans);
  const totalCartCount = activeItems.length + activePlans.length;

  const setGlobalLoading = useUIStore((s) => s.setGlobalLoading);
  const { data: addresses } = useAddresses();
  const { data: wallet } = useWalletBalance();
  const { evaluations } = useSmartCart();

  const insets = useSafeAreaInsets();
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentChoice>('razorpay');
  const [isPlacing, setIsPlacing] = useState(false);
  // Idempotency key — one per checkout session, refreshed only after a
  // successful order. A 409 drift retry deliberately reuses the same key.
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
  const isPlacingRef = useRef(false);    // synchronous double-tap guard
  const razorpayOpenRef = useRef(false); // tracks whether Razorpay sheet is live
  const queryClient = useQueryClient();

  // If the OS foregrounds the app while Razorpay was open but never called
  // back, unstick the Pay button. The order stays Pending — PendingPaymentBanner
  // handles recovery on HomeScreen.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && razorpayOpenRef.current) {
        setTimeout(() => {
          if (razorpayOpenRef.current) {
            razorpayOpenRef.current = false;
            isPlacingRef.current = false;
            setIsPlacing(false);
            setGlobalLoading(false);
          }
        }, 2000);
      }
    });
    return () => sub.remove();
  }, [setGlobalLoading]);

  React.useEffect(() => {
    if (addresses && addresses.length > 0 && !selectedAddressId) {
      const defaultAddr = addresses.find((a) => a.is_default) ?? addresses[0];
      setSelectedAddressId(defaultAddr.id);
    }
  }, [addresses, selectedAddressId]);

  // ── Server-authoritative quote ──────────────────────────────
  // Flat cart → quote-order derives cycles, dates, tax, fee, grand total.
  // Re-fetches whenever the selected address changes (the fee depends on it).
  const quoteItems = useMemo<QuoteItemInput[]>(() => {
    if (isSubscriptionOnly) return [];
    return cartType === 'food'
      ? foodItems.map((i) => ({ item_id: i.menu_item_id, item_type: 'food' as const, quantity: i.quantity }))
      : essItems.map((i) => ({ item_id: i.essential_item_id, item_type: 'essential' as const, quantity: i.quantity }));
  }, [isSubscriptionOnly, cartType, foodItems, essItems]);

  const quotePlans = useMemo(
    () => activePlans.map((p) => ({ plan_id: p.plan_id, start_date: p.start_date })),
    [activePlans],
  );

  const {
    data: quote,
    isLoading: quoteLoading,
    isError: quoteIsError,
    error: quoteError,
    refetch: refetchQuote,
  } = useOrderQuote({
    items: quoteItems,
    subscriptionPlans: quotePlans,
    deliveryAddressId: selectedAddressId,
    enabled: selectedAddressId != null && totalCartCount > 0,
  });

  const walletBalance = wallet?.balance ?? 0;
  const walletLoaded = wallet !== undefined;
  const grandTotal = quote?.grand_total ?? 0;
  const walletInsufficient =
    paymentMethod === 'wallet' && walletLoaded && !!quote && walletBalance < grandTotal;

  const handlePlaceOrder = useCallback(async () => {
    if (isPlacingRef.current) return;
    isPlacingRef.current = true;

    // Razorpay's RN SDK has no web support — wallet-only on web.
    if (Platform.OS === 'web' && paymentMethod === 'razorpay') {
      isPlacingRef.current = false;
      await infoDialog(
        'Mobile App Required',
        'Online payment is only available on the 1stOne mobile app. Please open the app on your phone to complete this order, or pay from your wallet here if you have sufficient balance.',
      );
      return;
    }
    if (!selectedAddressId) {
      isPlacingRef.current = false;
      Alert.alert('Address Required', 'Please select a delivery address');
      return;
    }
    if (totalCartCount === 0) {
      isPlacingRef.current = false;
      Alert.alert('Empty Cart', 'Add items or a subscription plan to your cart first');
      return;
    }
    if (!quote) {
      isPlacingRef.current = false;
      Alert.alert('One moment', 'Still calculating your order total — please try again in a second.');
      return;
    }
    if (quote.storm_mode) {
      isPlacingRef.current = false;
      Alert.alert('Orders Paused', 'Deliveries are paused due to adverse conditions. Please try again later.');
      return;
    }
    if (quote.serviceable === false) {
      isPlacingRef.current = false;
      Alert.alert('Outside Delivery Area', 'This address is outside our delivery zone. Please select a different address or add a new one.');
      return;
    }

    // Scenario-C consent — server-derived; the quote tells us if any cycle
    // shifted to the day after tomorrow.
    if (quote.has_scenario_c) {
      const latestDate = quote.dispatches.reduce(
        (m, d) => (d.dispatch_date > m ? d.dispatch_date : m),
        quote.dispatches[0]?.dispatch_date ?? '',
      );
      const proceed = await confirmDialog({
        title: 'Delivery in 2 days',
        message: `Some items have missed tomorrow's cutoff and will be delivered on ${formatDateLong(latestDate)}. Continue?`,
        confirmLabel: 'Place Order',
        cancelLabel: 'Cancel',
      });
      if (!proceed) {
        isPlacingRef.current = false;
        return;
      }
    }

    setIsPlacing(true);
    setGlobalLoading(true, 'Placing order...');

    try {
      const { data: { session: rawSession } } = await supabase.auth.getSession();

      const { data, error } = await supabase.functions.invoke('place-order', {
        headers: {
          Authorization: `Bearer ${rawSession?.access_token}`,
          'Idempotency-Key': idempotencyKeyRef.current,
        },
        body: {
          items: quoteItems,
          subscription_plans: quotePlans,
          delivery_address_id: selectedAddressId,
          payment_method: paymentMethod,
          // The drift tripwire — echoed verbatim from the quote the customer saw.
          client_quote: { total_paise: quote.total_paise, dispatches: quote.dispatches },
        },
      });

      if (error) {
        let parsed: any = null;
        try {
          const ctx = (error as any).context;
          if (ctx) {
            const text = await (ctx.clone ? ctx.clone() : ctx).text();
            parsed = JSON.parse(text);
          }
        } catch {}

        // Drift / stale quote — re-quote and ask the customer to re-confirm.
        if (parsed?.error === 'quote_changed' || parsed?.error === 'quote_required') {
          await refetchQuote();
          isPlacingRef.current = false;
          setIsPlacing(false);
          setGlobalLoading(false);
          Alert.alert(
            'Order Updated',
            'Pricing or delivery timing changed since you opened checkout. Please review the updated total and tap Pay again.',
          );
          return;
        }
        throw new Error(parsed?.error || 'Failed to place order');
      }

      const order = data;

      let razorpayAttempted = false;
      if (paymentMethod === 'razorpay' && order.razorpay_order_id) {
        razorpayAttempted = true;
        const rawPhone = session?.user.phone ?? '';
        const contact = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;
        const options = {
          description: '1stOne Order',
          currency: 'INR',
          key: RAZORPAY_KEY_ID,
          amount: Math.round(order.total_amount * 100),
          order_id: order.razorpay_order_id,
          name: '1stOne',
          prefill: { email: 'customer@1stone.in', contact },
          theme: { color: Theme.colors.action.primary },
        };

        setGlobalLoading(false);

        let rzpResult: any;
        try {
          razorpayOpenRef.current = true;
          rzpResult = await new Promise<any>((resolve, reject) => {
            setTimeout(() => RazorpayCheckout.open(options).then(resolve).catch(reject), 500);
          });
          razorpayOpenRef.current = false;
        } catch (e: any) {
          razorpayOpenRef.current = false;
          isPlacingRef.current = false;
          setIsPlacing(false);
          setGlobalLoading(false);
          if (e?.code === 'PAYMENT_CANCELLED') {
            Alert.alert('Payment Cancelled', 'Your order was not placed. Please try again.');
          } else {
            Alert.alert(
              'Payment Status Unknown',
              'There was a connectivity issue. Check the Orders tab in a few minutes.',
              [{ text: 'OK', onPress: () => navigation.popToTop() }],
            );
          }
          return;
        }

        // Confirm via Edge Function (service role bypasses RLS). Webhook is the fallback.
        try {
          const { data: { session: freshSession } } = await supabase.auth.getSession();
          const confirmBody = {
            order_id: order.id,
            razorpay_payment_id: rzpResult?.razorpay_payment_id,
            razorpay_order_id: order.razorpay_order_id,
            razorpay_signature: rzpResult?.razorpay_signature,
          };
          for (let attempt = 1; attempt <= 2; attempt++) {
            const { error: confirmErr } = await supabase.functions.invoke('confirm-order', {
              headers: { Authorization: `Bearer ${freshSession?.access_token}` },
              body: confirmBody,
            });
            if (!confirmErr) break;
            if (attempt === 1) await new Promise((r) => setTimeout(r, 1000));
          }
        } catch {
          // Webhook will resolve — silent fail is intentional.
        }
      }

      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MY_ORDERS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROFILE });
      if (activePlans.length > 0) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SUBSCRIPTIONS });
      }

      trackOrderPlaced(order.id ?? '', order.total_amount ?? grandTotal, paymentMethod, cartType);
      if (isSubscriptionOnly) {
        if (cartType === 'food') clearFoodPlans(); else clearEssPlans();
      } else {
        if (cartType === 'food') clearFood(); else clearEss();
      }
      idempotencyKeyRef.current = newIdempotencyKey();
      setGlobalLoading(false);

      const hadPlans = activePlans.length > 0;
      if (razorpayAttempted) {
        Alert.alert(
          hadPlans ? 'Order & Subscription Activated!' : 'Order Placed!',
          hadPlans
            ? 'Payment received. Your receipt is in My Orders; the plan is active in My Subscriptions.'
            : 'Payment received. You can track your order in the Orders tab.',
        );
      } else if (hadPlans) {
        Alert.alert(
          'Order & Subscription Activated!',
          'Your receipt is in My Orders; the plan is active in My Subscriptions.',
        );
      } else {
        Alert.alert('Order Placed!', 'You can track your order in the Orders tab.');
      }

      if (isSubscriptionOnly) {
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      } else {
        navigation.popToTop();
      }
    } catch (err: any) {
      trackOrderFailed(err.message || 'unknown', cartType);
      Alert.alert('Order Failed', err.message || 'Please try again');
    } finally {
      isPlacingRef.current = false;
      setIsPlacing(false);
      setGlobalLoading(false);
    }
  }, [
    quote, quoteItems, quotePlans, activePlans, isSubscriptionOnly,
    selectedAddressId, paymentMethod, session, refetchQuote,
    clearFood, clearEss, clearFoodPlans, clearEssPlans,
    navigation, setGlobalLoading, queryClient, cartType, totalCartCount, grandTotal,
  ]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">Checkout</ThemedText>
          <View style={{ width: 40 }} />
        </View>

        {/* Address */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            DELIVERY ADDRESS
          </ThemedText>
          {addresses && addresses.length > 0 ? (
            addresses.map((addr) => (
              <TouchableOpacity
                key={addr.id}
                style={[styles.addressCard, addr.id === selectedAddressId && styles.addressSelected]}
                onPress={async () => {
                  // MF-09: switching to an address in a different branch clears
                  // the cart — its items belong to the previous branch's catalog.
                  const currentBranch = addresses?.find((a) => a.id === selectedAddressId)?.branch_id ?? null;
                  const nextBranch = addr.branch_id ?? null;
                  const cartHasItems = (foodItems.length + foodPlans.length + essItems.length + essPlans.length) > 0;
                  if (
                    selectedAddressId != null &&
                    currentBranch != null &&
                    nextBranch != null &&
                    currentBranch !== nextBranch &&
                    cartHasItems
                  ) {
                    const ok = await confirmDialog({
                      title: 'Switch branch?',
                      message: 'Switching to this address moves you to a different branch — your cart will clear. Continue?',
                      confirmLabel: 'Switch & clear',
                      cancelLabel: 'Cancel',
                      destructive: true,
                    });
                    if (!ok) return;
                    clearFood();
                    clearEss();
                  }
                  setSelectedAddressId(addr.id);
                }}
              >
                <ThemedText variant="body" color="primary">{addr.label}</ThemedText>
                <ThemedText variant="small" color="subtitle">{addr.address_line}</ThemedText>
                {addr.landmark && (
                  <ThemedText variant="micro" color="muted">{addr.landmark}</ThemedText>
                )}
              </TouchableOpacity>
            ))
          ) : (
            <ThemedButton
              title="Add Delivery Address"
              variant="text"
              onPress={() => navigation.navigate('AddAddress')}
            />
          )}
        </View>

        <Divider />

        {/* Order Summary */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            ORDER SUMMARY
          </ThemedText>

          {!isSubscriptionOnly && cartType === 'food' && foodItems.map((item) => {
            const dispatch = evaluations.find((e) => e.menu_item_id === item.menu_item_id);
            return (
              <View key={item.menu_item_id} style={styles.summaryRow}>
                <View style={styles.summaryLeft}>
                  <ThemedText variant="body" color="primary">
                    {item.name} x{item.quantity}
                  </ThemedText>
                  {dispatch && (
                    <DispatchBadge
                      label={dispatch.dispatch_label}
                      variant={
                        dispatch.scenario === 'A' ? 'today'
                          : dispatch.scenario === 'B' ? 'tomorrow'
                          : 'warning'
                      }
                    />
                  )}
                </View>
                <ThemedText variant="body" color="subtitle">
                  {formatPriceShort(item.display_price * item.quantity)}
                </ThemedText>
              </View>
            );
          })}

          {!isSubscriptionOnly && cartType === 'essentials' && essItems.map((item) => (
            <View key={item.essential_item_id} style={styles.summaryRow}>
              <ThemedText variant="body" color="primary">
                {item.name} x{item.quantity}
              </ThemedText>
              <ThemedText variant="body" color="subtitle">
                {formatPriceShort(item.display_price * item.quantity)}
              </ThemedText>
            </View>
          ))}

          {activePlans.map((p) => (
            <View key={`plan-${p.plan_id}`} style={styles.summaryRow}>
              <ThemedText variant="body" color="primary">
                {p.plan_name} · {p.duration_days}d plan
              </ThemedText>
              <ThemedText variant="body" color="subtitle">
                {formatPriceShort(p.price)}
              </ThemedText>
            </View>
          ))}
        </View>

        <Divider />

        {/* Price Breakdown — server-authoritative (from quote-order) */}
        <View style={styles.section}>
          {quoteLoading || (!quote && !quoteIsError) ? (
            <View style={styles.quoteLoading}>
              <ActivityIndicator color={Theme.colors.action.primary} />
              <ThemedText variant="small" color="muted">Calculating total…</ThemedText>
            </View>
          ) : quoteIsError ? (
            <View style={styles.quoteLoading}>
              <Text style={styles.quoteErrorText}>
                {(quoteError as Error)?.message ?? 'Could not price your cart.'}
              </Text>
              <TouchableOpacity onPress={() => refetchQuote()}>
                <ThemedText variant="small" color="accent">Retry</ThemedText>
              </TouchableOpacity>
            </View>
          ) : quote ? (
            <>
              <View style={styles.priceRow}>
                <ThemedText variant="small" color="subtitle">Subtotal</ThemedText>
                <ThemedText variant="small" color="subtitle">{formatPriceShort(quote.subtotal_total)}</ThemedText>
              </View>
              <View style={styles.priceRow}>
                <ThemedText variant="small" color="subtitle">Tax</ThemedText>
                <ThemedText variant="small" color="subtitle">{formatPriceShort(quote.tax_total)}</ThemedText>
              </View>
              <View style={styles.priceRow}>
                <ThemedText variant="small" color="subtitle">Delivery</ThemedText>
                <ThemedText variant="small" color="subtitle">
                  {quote.fee_pending ? 'At checkout' : quote.delivery_fee === 0 ? 'Free' : formatPriceShort(quote.delivery_fee)}
                </ThemedText>
              </View>
              <View style={[styles.priceRow, styles.totalRow]}>
                <ThemedText variant="subtitle" color="primary">Total</ThemedText>
                <ThemedText variant="subtitle" color="accent">{formatPriceShort(quote.grand_total)}</ThemedText>
              </View>
            </>
          ) : null}
        </View>

        <Divider />

        {/* Payment */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>PAYMENT</ThemedText>
          <TouchableOpacity
            style={[styles.paymentOption, paymentMethod === 'razorpay' && styles.paymentSelected]}
            onPress={() => setPaymentMethod('razorpay')}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityLabel="Pay online via Razorpay"
            accessibilityState={{ selected: paymentMethod === 'razorpay' }}
          >
            <ThemedText variant="body" color="primary">Pay Online (Razorpay)</ThemedText>
            <ThemedText variant="micro" color="muted">UPI, Card, Net Banking</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.paymentOption, paymentMethod === 'wallet' && styles.paymentSelected]}
            onPress={() => setPaymentMethod('wallet')}
            accessibilityRole="radio"
            accessibilityLabel="Pay from wallet"
            accessibilityState={{ selected: paymentMethod === 'wallet' }}
          >
            <View style={styles.paymentRow}>
              <ThemedText variant="body" color="primary">Wallet Balance</ThemedText>
              <ThemedText variant="body" color={!quote || walletBalance >= grandTotal ? 'accent' : 'subtitle'}>
                {formatPriceShort(walletBalance)}
              </ThemedText>
            </View>
            {paymentMethod === 'wallet' && walletInsufficient && (
              <View style={styles.paymentRow}>
                <ThemedText variant="small" color="muted">
                  Need {formatPriceShort(grandTotal - walletBalance)} more
                </ThemedText>
                <TouchableOpacity onPress={() => navigation.navigate('Wallet')}>
                  <ThemedText variant="small" color="accent">Top Up ›</ThemedText>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[styles.floatBtn, { bottom: insets.bottom + 16 }]}
        activeOpacity={0.85}
        onPress={handlePlaceOrder}
        disabled={!selectedAddressId || totalCartCount === 0 || isPlacing || !quote || walletInsufficient}
        accessibilityRole="button"
        accessibilityLabel={paymentMethod === 'wallet' ? 'Pay from wallet' : 'Pay online'}
        accessibilityState={{
          disabled: !selectedAddressId || totalCartCount === 0 || isPlacing || !quote || walletInsufficient,
          busy: isPlacing,
        }}
      >
        {isPlacing
          ? <ActivityIndicator color={Theme.colors.text.mint} />
          : <>
              <Text style={styles.floatBtnText}>
                Pay {quote ? formatPriceShort(quote.grand_total) : '…'}
              </Text>
              <Text style={styles.floatBtnText}>›</Text>
            </>
        }
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { paddingBottom: 100 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  section: { padding: Theme.spacing.md },
  sectionLabel: { letterSpacing: 1, marginBottom: Theme.spacing.sm },
  addressCard: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  addressSelected: { borderColor: Theme.colors.action.primary },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.xs,
  },
  summaryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  totalRow: {
    marginTop: Theme.spacing.xs,
    paddingTop: Theme.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.layout.divider,
  },
  quoteLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
  },
  quoteErrorText: {
    flex: 1,
    color: Theme.colors.status.error,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small,
  },
  paymentOption: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  paymentSelected: { borderColor: Theme.colors.action.primary },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  floatBtn: {
    position: 'absolute',
    left: Theme.spacing.md,
    right: Theme.spacing.md,
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
  },
  floatBtnText: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.subtitle + 2,
    fontWeight: '400',
  },
});
