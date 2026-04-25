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

/** Safe UUID generator — falls back to Math.random when crypto.randomUUID is unavailable (Expo Go, older Android) */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

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
  const idempotencyKeyRef = useRef<string>(generateId());
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
      let dispatchDate: string;
      if (cartType === 'food') {
        // Validate all items share the same dispatch scenario before proceeding
        const scenarios = [...new Set(evaluations.map((e) => e.scenario))];
        if (scenarios.length > 1) {
          throw new Error('Your cart has items dispatching on different days. Please checkout one cycle at a time.');
        }
        // Food uses smart cart scenario (A = today, B = tomorrow based on cutoff)
        const firstEval = evaluations[0];
        if (firstEval?.scenario === 'B') {
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          dispatchDate = tomorrow.toISOString().split('T')[0];
        } else {
          dispatchDate = today.toISOString().split('T')[0];
        }
      } else {
        // Essentials always dispatch today
        dispatchDate = today.toISOString().split('T')[0];
      }

      const { data: { session: rawSession } } = await supabase.auth.getSession();

      const { data, error } = await supabase.functions.invoke('place-order', {
        headers: {
          Authorization: `Bearer ${rawSession?.access_token}`,
          'Idempotency-Key': idempotencyKeyRef.current,
        },
        body: {
          // In subscription-only mode, items are fully suppressed from the payload.
          food_items: (!isSubscriptionOnly && cartType === 'food') ? foodItems.map((i) => ({
            menu_item_id: i.menu_item_id,
            quantity: i.quantity,
          })) : [],
          essentials_items: (!isSubscriptionOnly && cartType === 'essentials') ? essItems.map((i) => ({
            essential_item_id: i.essential_item_id,
            quantity: i.quantity,
          })) : [],
          subscription_plans: activePlans.map((p) => ({
            plan_id: p.plan_id,
            start_date: p.start_date,
          })),
          cycle_id: isSubscriptionOnly
            ? (subPlan?.cycle_id ?? null)
            : cartType === 'food'
              ? (foodItems[0]?.cycle_id ?? foodPlans[0]?.cycle_id ?? null)
              : (essItems[0]?.cycle_id ?? essPlans[0]?.cycle_id ?? null),
          delivery_address_id: selectedAddressId,
          payment_method: paymentMethod,
          dispatch_date: dispatchDate,
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
          const { error: confirmErr } = await supabase.functions.invoke('confirm-order', {
            headers: { Authorization: `Bearer ${freshSession?.access_token}` },
            body: {
              order_id: order.id,
              razorpay_payment_id: rzpResult?.razorpay_payment_id,
              razorpay_order_id: order.razorpay_order_id,
              razorpay_signature: rzpResult?.razorpay_signature,
            },
          });
          if (!confirmErr) queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MY_ORDERS });
        } catch {
          // Webhook will resolve — silent fail is intentional.
        }
      }

      trackOrderPlaced(order.id ?? '', order.total_amount ?? estimatedTotal, paymentMethod, cartType);
      // Sub-only checkout must not wipe user's regular cart items — only clear the plan slot.
      if (isSubscriptionOnly) {
        if (cartType === 'food') clearFoodPlans(); else clearEssPlans();
      } else {
        if (cartType === 'food') clearFood(); else clearEss();
      }
      idempotencyKeyRef.current = generateId();
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
                onPress={() => setSelectedAddressId(addr.id)}
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
                      variant={dispatch.scenario === 'A' ? 'today' : 'tomorrow'}
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
