/**
 * 1stOne F1 — Checkout Screen
 *
 * Handles food + essentials orders. Razorpay payments are confirmed
 * via the confirm-order Edge Function (service-role, HMAC-verified).
 * The verify-payment webhook is a secondary safety net.
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../../utils/constants';
import { useCartStore } from '../../store/cartStore';
import { useEssentialsCartStore } from '../../store/essentialsCartStore';
import { useUIStore } from '../../store/uiStore';
import { useAddresses } from '../../hooks/useAddresses';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { useWalletBalance } from '../../hooks/useWallet';
import { useSmartCart } from '../../hooks/useSmartCart';
import { useAuth } from '../../hooks/useAuth';
import { formatPriceShort } from '../../utils/formatters';
import { supabase } from '../../api/supabaseClient';
import { RAZORPAY_KEY_ID } from '../../utils/env';
import { trackOrderPlaced, trackOrderFailed } from '../../utils/analytics';
import { infoDialog, confirmDialog } from '../../utils/confirmDialog';
import { formatDateLong } from '../../utils/formatters';
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
  const foodTotal = useCartStore((s) => s.getDisplayTotal());

  const essItems = useEssentialsCartStore((s) => s.items);
  const essPlans = useEssentialsCartStore((s) => s.plans);
  const clearEss = useEssentialsCartStore((s) => s.clearCart);
  const clearEssPlans = useEssentialsCartStore((s) => s.clearPlans);
  const essTotal = useEssentialsCartStore((s) => s.getDisplayTotal());

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
  const displayTotal = isSubscriptionOnly
    ? (subPlan?.price ?? 0)
    : (cartType === 'food' ? foodTotal : essTotal);
  // Cart has something to check out when there are items OR plans
  const totalCartCount = activeItems.length + activePlans.length;

  const setGlobalLoading = useUIStore((s) => s.setGlobalLoading);
  const { data: addresses } = useAddresses();
  const { data: config } = useStoreConfig();
  const { data: wallet } = useWalletBalance();
  const { evaluations } = useSmartCart();

  const insets = useSafeAreaInsets();
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentChoice>('razorpay');
  const [isPlacing, setIsPlacing] = useState(false);
  // Idempotency key — generated once per checkout session, refreshed after successful order
  // Use Math.random fallback: crypto.randomUUID() is not available in all RN/Expo Go environments
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
  const isPlacingRef = useRef(false);    // synchronous double-tap guard
  const razorpayOpenRef = useRef(false); // tracks whether Razorpay sheet is live
  const queryClient = useQueryClient();

  // If the OS brings the app to foreground while Razorpay was open but never
  // called back (killed webview, memory pressure), unstick the Pay button.
  // The order stays Pending — PendingPaymentBanner handles recovery on HomeScreen.
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

  // Derive zone_id from the selected address
  const selectedZoneId = useMemo(
    () => addresses?.find((a) => a.id === selectedAddressId)?.zone_id ?? null,
    [addresses, selectedAddressId]
  );

  // Fetch the zone's delivery_fee_override when the address belongs to a zone
  const { data: zoneOverride } = useQuery({
    queryKey: ['zone_fee', selectedZoneId],
    queryFn: async () => {
      const { data } = await supabase
        .from('delivery_zones')
        .select('delivery_fee_override')
        .eq('id', selectedZoneId!)
        .maybeSingle();
      return data?.delivery_fee_override ?? null;
    },
    enabled: selectedZoneId != null,
    staleTime: 10 * 60 * 1000,
  });

  const taxRate = config?.tax_rate_percentage ?? 5;
  const globalDeliveryFee = config?.delivery_fee ?? 0;
  // Use zone override when the address belongs to a zone that has one set
  const deliveryFee = zoneOverride != null ? zoneOverride : globalDeliveryFee;
  const estimatedTax = displayTotal * (taxRate / 100);
  const estimatedTotal = displayTotal + estimatedTax + deliveryFee;

  const walletBalance = wallet?.balance ?? 0;
  const walletLoaded = wallet !== undefined;
  const walletInsufficient = paymentMethod === 'wallet' && walletLoaded && walletBalance < estimatedTotal;

  const handlePlaceOrder = useCallback(async () => {
    if (isPlacingRef.current) return;
    isPlacingRef.current = true;

    // Razorpay's React Native SDK doesn't support browsers. Customers on
    // web can browse + view their account but must use the mobile app to
    // pay. Block before any DB writes happen.
    if (Platform.OS === 'web' && paymentMethod === 'razorpay') {
      isPlacingRef.current = false;
      await infoDialog(
        'Mobile App Required',
        'Online payment is only available on the 1stOne mobile app. Please open the app on your phone to complete this order, or pay from your wallet here if you have sufficient balance.',
      );
      return;
    }

    if (config?.storm_mode_active) {
      isPlacingRef.current = false;
      Alert.alert('Orders Paused', 'Deliveries are paused due to adverse conditions. Please try again later.');
      return;
    }
    if (!selectedAddressId) {
      isPlacingRef.current = false;
      Alert.alert('Address Required', 'Please select a delivery address');
      return;
    }
    const selectedAddr = addresses?.find((a) => a.id === selectedAddressId);
    if (selectedAddr && selectedAddr.is_serviceable === false) {
      isPlacingRef.current = false;
      Alert.alert('Outside Delivery Area', 'This address is outside our delivery zone. Please select a different address or add a new one.');
      return;
    }
    if (totalCartCount === 0) {
      isPlacingRef.current = false;
      Alert.alert('Empty Cart', 'Add items or a subscription plan to your cart first');
      return;
    }

    setIsPlacing(true);
    setGlobalLoading(true, 'Placing order...');

    try {
      const today = new Date();
      const dateStr = (d: Date) => d.toISOString().split('T')[0];
      const todayStr = dateStr(today);
      const tomorrowStr = (() => { const d = new Date(today); d.setDate(d.getDate() + 1); return dateStr(d); })();
      const dayAfterStr = (() => { const d = new Date(today); d.setDate(d.getDate() + 2); return dateStr(d); })();
      // Smart-cart scenario per cycle: A = today, B = tomorrow,
      // C = day after tomorrow (BF-41 cross-midnight after-cutoff).
      const scenarioToDate = (s: string | undefined) =>
        s === 'C' ? dayAfterStr : s === 'B' ? tomorrowStr : todayStr;

      // ── Build dispatch groups (MF-10) ──────────────────────
      // A checkout can span multiple cycles; each cycle is one group →
      // one order row. Items are grouped by cycle_id. The server
      // re-derives + validates each item's cycle before pricing.
      const groups: any[] = [];

      if (!isSubscriptionOnly && cartType === 'food' && foodItems.length > 0) {
        const cycleIds = [...new Set(foodItems.map((i) => i.cycle_id))];
        let anyDayAfter = false;
        for (const cycleId of cycleIds) {
          const scenario = evaluations.find((e) => e.cycle_id === cycleId)?.scenario;
          if (scenario === 'C') anyDayAfter = true;
          groups.push({
            cycle_id: cycleId,
            dispatch_date: scenarioToDate(scenario),
            food_items: foodItems
              .filter((i) => i.cycle_id === cycleId)
              .map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity })),
          });
        }
        // Scenario-C consent — once, if any cycle has shifted to day-after.
        if (anyDayAfter) {
          const proceed = await confirmDialog({
            title: 'Delivery in 2 days',
            message: `Some items have missed tomorrow's cutoff and will be delivered on ${formatDateLong(dayAfterStr)}. Continue?`,
            confirmLabel: 'Place Order',
            cancelLabel: 'Cancel',
          });
          if (!proceed) {
            isPlacingRef.current = false;
            setIsPlacing(false);
            setGlobalLoading(false);
            return;
          }
        }
      } else if (!isSubscriptionOnly && cartType === 'essentials' && essItems.length > 0) {
        // Essentials dispatch today; still one group per cycle so each
        // cycle's items reach the correct kitchen / packing queue.
        const cycleIds = [...new Set(essItems.map((i) => i.cycle_id))];
        for (const cycleId of cycleIds) {
          groups.push({
            cycle_id: cycleId,
            dispatch_date: todayStr,
            essentials_items: essItems
              .filter((i) => i.cycle_id === cycleId)
              .map((i) => ({ essential_item_id: i.essential_item_id, quantity: i.quantity })),
          });
        }
      }

      const { data: { session: rawSession } } = await supabase.auth.getSession();

      const { data, error } = await supabase.functions.invoke('place-order', {
        headers: {
          Authorization: `Bearer ${rawSession?.access_token}`,
          'Idempotency-Key': idempotencyKeyRef.current,
        },
        body: {
          groups,
          subscription_plans: activePlans.map((p) => ({
            plan_id: p.plan_id,
            start_date: p.start_date,
          })),
          // Used by place-order only for a subscription-purchase order.
          dispatch_date: todayStr,
          delivery_address_id: selectedAddressId,
          payment_method: paymentMethod,
        },
      });

      if (error) {
        let message = 'Failed to place order';
        try {
          const ctx = (error as any).context;
          if (ctx) {
            const text = await (ctx.clone ? ctx.clone() : ctx).text();
            const parsed = JSON.parse(text);
            if (parsed?.error) message = parsed.error;
          }
        } catch {}
        throw new Error(message);
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
          // 500ms lets UIKit finish dismissing the loading modal before Razorpay presents.
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
            // Payment may have reached Razorpay — leave Pending, webhook resolves it.
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

      trackOrderPlaced(order.id ?? '', order.total_amount ?? estimatedTotal, paymentMethod, cartType);
      // Sub-only checkout must not wipe user's regular cart items — only clear the plan slot.
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
            : 'Payment received. You can track your order in the Orders tab.'
        );
      } else if (hadPlans) {
        Alert.alert(
          'Order & Subscription Activated!',
          'Your receipt is in My Orders; the plan is active in My Subscriptions.'
        );
      } else {
        Alert.alert(
          'Order Placed!',
          'You can track your order in the Orders tab.'
        );
      }
      // Sub-only flow: ensure we don't linger on the now-empty filtered Cart — land on Home.
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
    foodItems, essItems, foodPlans, essPlans, activePlans,
    isSubscriptionOnly, subPlan,
    selectedAddressId, paymentMethod,
    evaluations, session, clearFood, clearEss, clearFoodPlans, clearEssPlans,
    navigation, setGlobalLoading,
    cartType, totalCartCount,
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
                  // the cart — its items belong to the previously-selected
                  // branch's catalog and won't price-validate in place-order.
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

          {cartType === 'food' && foodItems.map((item) => {
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
                          : 'warning' /* 'C' — day after tomorrow, visually distinct */
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

          {cartType === 'essentials' && essItems.map((item) => (
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

        {/* Price Breakdown */}
        <View style={styles.section}>
          <View style={styles.priceRow}>
            <ThemedText variant="small" color="subtitle">Subtotal</ThemedText>
            <ThemedText variant="small" color="subtitle">{formatPriceShort(displayTotal)}</ThemedText>
          </View>
          <View style={styles.priceRow}>
            <ThemedText variant="small" color="subtitle">Tax ({taxRate}%)</ThemedText>
            <ThemedText variant="small" color="subtitle">{formatPriceShort(estimatedTax)}</ThemedText>
          </View>
          <View style={styles.priceRow}>
            <ThemedText variant="small" color="subtitle">Delivery</ThemedText>
            <ThemedText variant="small" color="subtitle">
              {deliveryFee === 0 ? 'Free' : formatPriceShort(deliveryFee)}
            </ThemedText>
          </View>
          <View style={[styles.priceRow, styles.totalRow]}>
            <ThemedText variant="subtitle" color="primary">Estimated Total</ThemedText>
            <ThemedText variant="subtitle" color="accent">{formatPriceShort(estimatedTotal)}</ThemedText>
          </View>
          <ThemedText variant="micro" color="muted">Server recalculates final amount</ThemedText>
        </View>

        <Divider />

        {/* Payment */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>PAYMENT</ThemedText>
          <TouchableOpacity
            style={[
              styles.paymentOption,
              paymentMethod === 'razorpay' && styles.paymentSelected,
            ]}
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
              <ThemedText variant="body" color={walletBalance >= estimatedTotal ? 'accent' : 'subtitle'}>
                {formatPriceShort(walletBalance)}
              </ThemedText>
            </View>
            {paymentMethod === 'wallet' && walletInsufficient && (
              <View style={styles.paymentRow}>
                <ThemedText variant="small" color="muted">
                  Need {formatPriceShort(estimatedTotal - walletBalance)} more
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
        disabled={!selectedAddressId || totalCartCount === 0 || isPlacing}
        accessibilityRole="button"
        accessibilityLabel={paymentMethod === 'wallet' ? 'Pay from wallet' : 'Pay online'}
        accessibilityState={{
          disabled: !selectedAddressId || totalCartCount === 0 || isPlacing,
          busy: isPlacing,
        }}
      >
        {isPlacing
          ? <ActivityIndicator color={Theme.colors.text.mint} />
          : <>
              <Text style={styles.floatBtnText}>Pay {formatPriceShort(estimatedTotal)}</Text>
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
  subSectionLabel: { letterSpacing: 1, marginTop: Theme.spacing.sm, marginBottom: Theme.spacing.xs },
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
