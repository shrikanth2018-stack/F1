/**
 * 1stOne F1 — Checkout Screen
 *
 * Handles food items, essentials items, or both in one order.
 * RULE: Client NEVER confirms payment. Razorpay webhook does.
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  ScrollView,
  Alert,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RazorpayCheckout from '../../utils/razorpay';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { Divider } from '../../components/Divider';
import { DispatchBadge } from '../../components/DispatchBadge';
import { useQuery } from '@tanstack/react-query';
import { useCartStore } from '../../store/cartStore';
import { useEssentialsCartStore } from '../../store/essentialsCartStore';
import { useUIStore } from '../../store/uiStore';
import { useAddresses } from '../../hooks/useAddresses';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { useWalletBalance } from '../../hooks/useWallet';
import { useSmartCart } from '../../hooks/useSmartCart';
import { useAuth } from '../../hooks/useAuth';
import { usePendingRazorpayOrder } from '../../hooks/useOrders';
import { PendingPaymentBanner } from '../../components/PendingPaymentBanner';
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
  const { session } = useAuth();

  const foodItems = useCartStore((s) => s.items);
  const clearFood = useCartStore((s) => s.clearCart);
  const foodTotal = useCartStore((s) => s.getDisplayTotal());

  const essItems = useEssentialsCartStore((s) => s.items);
  const clearEss = useEssentialsCartStore((s) => s.clearCart);
  const essTotal = useEssentialsCartStore((s) => s.getDisplayTotal());

  const activeItems = cartType === 'food' ? foodItems : essItems;
  const displayTotal = cartType === 'food' ? foodTotal : essTotal;
  const totalItemCount = activeItems.length;

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
  const { data: pendingOrders } = usePendingRazorpayOrder();
  const pendingOrder = pendingOrders?.[0] ?? null;

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
    if (config?.storm_mode_active) {
      Alert.alert('Orders Paused', 'Deliveries are paused due to adverse conditions. Please try again later.');
      return;
    }
    if (!selectedAddressId) {
      Alert.alert('Address Required', 'Please select a delivery address');
      return;
    }
    if (totalItemCount === 0) {
      Alert.alert('Empty Cart', 'Add items to your cart first');
      return;
    }

    setIsPlacing(true);
    setGlobalLoading(true, 'Placing order...');

    try {
      const today = new Date();
      let dispatchDate: string;
      if (cartType === 'food') {
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
          food_items: cartType === 'food' ? foodItems.map((i) => ({
            menu_item_id: i.menu_item_id,
            quantity: i.quantity,
          })) : [],
          essentials_items: cartType === 'essentials' ? essItems.map((i) => ({
            essential_item_id: i.essential_item_id,
            quantity: i.quantity,
          })) : [],
          cycle_id: cartType === 'food' ? foodItems[0]?.cycle_id ?? null : essItems[0]?.cycle_id ?? null,
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

      // Wallet path: order already Confirmed server-side, nothing more to do.
      // Razorpay path: order is Pending. Open checkout; on success the webhook
      // will flip it to Paid. Client NEVER confirms payment itself.
      let razorpayAttempted = false;
      let razorpaySucceeded = false;
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
          prefill: {
            email: 'customer@1stone.in',
            contact,
          },
          theme: { color: Theme.colors.action.primary },
        };
        try {
          await Promise.race([
            RazorpayCheckout.open(options),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 30_000)
            ),
          ]);
          razorpaySucceeded = true;
        } catch (e: any) {
          razorpaySucceeded = false;
          console.warn('[CheckoutScreen] Razorpay closed:', e?.description ?? e?.message);
        }
      }

      if (razorpayAttempted && !razorpaySucceeded) {
        // User cancelled / payment sheet failed. Order sits Pending on the server
        // until the webhook reports success or the order is cleaned up. Clear cart
        // and show a clear message — no "pay later" surface exists yet.
        setGlobalLoading(false);
        Alert.alert(
          'Payment Cancelled',
          'Your order was not placed because payment did not complete. Please try again.',
        );
        return;
      }

      trackOrderPlaced(order.id ?? '', order.total_amount ?? estimatedTotal, paymentMethod, cartType);
      if (cartType === 'food') clearFood(); else clearEss();
      // Rotate the idempotency key so a new order gets a fresh key
      idempotencyKeyRef.current = generateId();
      setGlobalLoading(false);

      if (razorpayAttempted && razorpaySucceeded) {
        Alert.alert(
          'Payment Processing',
          'We\u2019ll confirm your order as soon as your bank clears it. You can track it in Orders.',
        );
      }
      navigation.navigate('Orders');
    } catch (err: any) {
      trackOrderFailed(err.message || 'unknown', cartType);
      Alert.alert('Order Failed', err.message || 'Please try again');
    } finally {
      setIsPlacing(false);
      setGlobalLoading(false);
    }
  }, [
    foodItems, essItems, selectedAddressId, paymentMethod,
    evaluations, session, clearFood, clearEss, navigation, setGlobalLoading,
    cartType, totalItemCount,
  ]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Pending payment warning — blocks duplicate Razorpay attempt */}
        {pendingOrder && (
          <PendingPaymentBanner
            order={pendingOrder}
            onViewOrder={() => navigation.navigate('Orders')}
          />
        )}

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
              !!pendingOrder && styles.paymentDisabled,
            ]}
            onPress={() => !pendingOrder && setPaymentMethod('razorpay')}
            activeOpacity={pendingOrder ? 1 : 0.7}
          >
            <ThemedText variant="body" color={pendingOrder ? 'muted' : 'primary'}>
              Pay Online (Razorpay)
            </ThemedText>
            <ThemedText variant="micro" color="muted">
              {pendingOrder ? 'Unavailable — previous payment still confirming' : 'UPI, Card, Net Banking'}
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.paymentOption, paymentMethod === 'wallet' && styles.paymentSelected]}
            onPress={() => setPaymentMethod('wallet')}
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
        disabled={!selectedAddressId || totalItemCount === 0 || isPlacing}
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
  paymentDisabled: { opacity: 0.45 },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  floatBtn: {
    position: 'absolute',
    left: Theme.spacing.md,
    right: Theme.spacing.md,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  floatBtnText: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    fontWeight: '600',
  },
});
