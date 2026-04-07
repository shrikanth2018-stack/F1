/**
 * 1stOne F1 — Checkout Screen
 *
 * Flow:
 * 1. Select/add delivery address
 * 2. Review order summary (server-recalculated)
 * 3. Choose payment: Wallet / Razorpay / Split
 * 4. Place order → if Razorpay, open payment gateway
 * 5. On payment success → server webhook confirms → navigate to order detail
 *
 * RULE: Client NEVER confirms payment. Razorpay webhook does.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  Alert,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import RazorpayCheckout from 'react-native-razorpay';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { Divider } from '../../components/Divider';
import { DispatchBadge } from '../../components/DispatchBadge';
import { useCartStore } from '../../store/cartStore';
import { useUIStore } from '../../store/uiStore';
import { useAddresses } from '../../hooks/useAddresses';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { useSmartCart } from '../../hooks/useSmartCart';
import { useAuth } from '../../hooks/useAuth';
import { formatPriceShort, formatPhone } from '../../utils/formatters';
import { supabase } from '../../api/supabaseClient';
import { SUPABASE_URL, RAZORPAY_KEY_ID } from '../../utils/env';

type PaymentChoice = 'razorpay' | 'wallet';

export function CheckoutScreen({ navigation }: any) {
  const { session } = useAuth();
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);
  const displayTotal = useCartStore((s) => s.getDisplayTotal());
  const setGlobalLoading = useUIStore((s) => s.setGlobalLoading);

  const { data: addresses } = useAddresses();
  const { data: config } = useStoreConfig();
  const { evaluations } = useSmartCart();

  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentChoice>('razorpay');
  const [isPlacing, setIsPlacing] = useState(false);

  // Auto-select default address
  React.useEffect(() => {
    if (addresses && addresses.length > 0 && !selectedAddressId) {
      const defaultAddr = addresses.find((a) => a.is_default) ?? addresses[0];
      setSelectedAddressId(defaultAddr.id);
    }
  }, [addresses, selectedAddressId]);

  const taxRate = config?.tax_rate_percentage ?? 5;
  const deliveryFee = config?.delivery_fee ?? 0;
  const estimatedTax = displayTotal * (taxRate / 100);
  const estimatedTotal = displayTotal + estimatedTax + deliveryFee;

  const handlePlaceOrder = useCallback(async () => {
    if (!selectedAddressId) {
      Alert.alert('Address Required', 'Please select a delivery address');
      return;
    }

    if (items.length === 0) {
      Alert.alert('Empty Cart', 'Add items to your cart first');
      return;
    }

    setIsPlacing(true);
    setGlobalLoading(true, 'Placing order...');

    try {
      // Determine dispatch date from first item's evaluation
      const firstEval = evaluations[0];
      const today = new Date();
      let dispatchDate: string;

      if (firstEval?.scenario === 'B') {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        dispatchDate = tomorrow.toISOString().split('T')[0];
      } else {
        dispatchDate = today.toISOString().split('T')[0];
      }

      // Call Edge Function to place order
      const { data, error } = await supabase.functions.invoke('place-order', {
        body: {
          items: items.map((i) => ({
            menu_item_id: i.menu_item_id,
            quantity: i.quantity,
          })),
          cycle_id: items[0].cycle_id,
          delivery_address_id: selectedAddressId,
          payment_method: paymentMethod,
          dispatch_date: dispatchDate,
        },
      });

      if (error) {
        throw new Error(error.message || 'Failed to place order');
      }

      const order = data;

      // If Razorpay, open payment gateway
      if (paymentMethod === 'razorpay' && order.razorpay_order_id) {
        const options = {
          description: '1stOne Food Order',
          currency: 'INR',
          key: RAZORPAY_KEY_ID,
          amount: Math.round(order.total_amount * 100), // Razorpay expects paise
          order_id: order.razorpay_order_id,
          name: '1stOne',
          prefill: {
            contact: session?.user.phone ?? '',
          },
          theme: { color: Theme.colors.action.primary },
        };

        try {
          await RazorpayCheckout.open(options);
          // Payment success on client side
          // But we DON'T confirm here — webhook handles it
        } catch (paymentError: any) {
          // Payment cancelled or failed
          Alert.alert(
            'Payment Cancelled',
            'Your order has been saved. You can pay later from your orders.'
          );
        }
      }

      // Clear cart and navigate to order
      clearCart();
      setGlobalLoading(false);
      navigation.navigate('Orders');
    } catch (err: any) {
      Alert.alert('Order Failed', err.message || 'Please try again');
    } finally {
      setIsPlacing(false);
      setGlobalLoading(false);
    }
  }, [
    items,
    selectedAddressId,
    paymentMethod,
    evaluations,
    session,
    clearCart,
    navigation,
    setGlobalLoading,
  ]);

  const selectedAddress = addresses?.find((a) => a.id === selectedAddressId);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">
              ‹ Back
            </ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">
            Checkout
          </ThemedText>
          <View style={{ width: 40 }} />
        </View>

        {/* Address Selection */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            DELIVERY ADDRESS
          </ThemedText>
          {addresses && addresses.length > 0 ? (
            addresses.map((addr) => (
              <TouchableOpacity
                key={addr.id}
                style={[
                  styles.addressCard,
                  addr.id === selectedAddressId && styles.addressSelected,
                ]}
                onPress={() => setSelectedAddressId(addr.id)}
              >
                <ThemedText variant="body" color="primary">
                  {addr.label}
                </ThemedText>
                <ThemedText variant="small" color="subtitle">
                  {addr.address_line}
                </ThemedText>
                {addr.landmark && (
                  <ThemedText variant="micro" color="muted">
                    {addr.landmark}
                  </ThemedText>
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
          {items.map((item) => {
            const dispatch = evaluations.find(
              (e) => e.menu_item_id === item.menu_item_id
            );
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
        </View>

        <Divider />

        {/* Price Breakdown */}
        <View style={styles.section}>
          <View style={styles.priceRow}>
            <ThemedText variant="small" color="subtitle">
              Subtotal
            </ThemedText>
            <ThemedText variant="small" color="subtitle">
              {formatPriceShort(displayTotal)}
            </ThemedText>
          </View>
          <View style={styles.priceRow}>
            <ThemedText variant="small" color="subtitle">
              Tax ({taxRate}%)
            </ThemedText>
            <ThemedText variant="small" color="subtitle">
              {formatPriceShort(estimatedTax)}
            </ThemedText>
          </View>
          <View style={styles.priceRow}>
            <ThemedText variant="small" color="subtitle">
              Delivery
            </ThemedText>
            <ThemedText variant="small" color="subtitle">
              {deliveryFee === 0 ? 'Free' : formatPriceShort(deliveryFee)}
            </ThemedText>
          </View>
          <View style={[styles.priceRow, styles.totalRow]}>
            <ThemedText variant="subtitle" color="primary">
              Estimated Total
            </ThemedText>
            <ThemedText variant="subtitle" color="accent">
              {formatPriceShort(estimatedTotal)}
            </ThemedText>
          </View>
          <ThemedText variant="micro" color="muted">
            Server recalculates final amount
          </ThemedText>
        </View>

        <Divider />

        {/* Payment Method */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            PAYMENT
          </ThemedText>
          <TouchableOpacity
            style={[
              styles.paymentOption,
              paymentMethod === 'razorpay' && styles.paymentSelected,
            ]}
            onPress={() => setPaymentMethod('razorpay')}
          >
            <ThemedText variant="body" color="primary">
              Pay Online (Razorpay)
            </ThemedText>
            <ThemedText variant="micro" color="muted">
              UPI, Card, Net Banking
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.paymentOption,
              paymentMethod === 'wallet' && styles.paymentSelected,
            ]}
            onPress={() => setPaymentMethod('wallet')}
          >
            <ThemedText variant="body" color="primary">
              Wallet Balance
            </ThemedText>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Place Order Button */}
      <View style={styles.footer}>
        <ThemedButton
          title={`Pay ${formatPriceShort(estimatedTotal)}`}
          onPress={handlePlaceOrder}
          loading={isPlacing}
          disabled={!selectedAddressId || items.length === 0}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  content: {
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  section: {
    padding: Theme.spacing.md,
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: Theme.spacing.sm,
  },
  addressCard: {
    backgroundColor: Theme.colors.background.card,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  addressSelected: {
    borderColor: Theme.colors.action.primary,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.xs,
  },
  summaryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  totalRow: {
    marginTop: Theme.spacing.xs,
    paddingTop: Theme.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.layout.divider,
  },
  paymentOption: {
    backgroundColor: Theme.colors.background.card,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  paymentSelected: {
    borderColor: Theme.colors.action.primary,
  },
  footer: {
    padding: Theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.layout.divider,
    backgroundColor: Theme.colors.background.card,
  },
});
