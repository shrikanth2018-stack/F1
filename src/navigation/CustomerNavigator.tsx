/**
 * 1stOne F1 — Customer Navigator
 *
 * NO bottom tab bar. HomeScreen is the main view.
 * A simple "Subscriptions" text link at bottom of HomeScreen
 * handles navigation to subscriptions.
 * Profile popup handles: Orders, Wallet, Addresses, etc.
 * Stack pushes for all detail screens.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../screens/customer/HomeScreen';
import { OrdersScreen } from '../screens/customer/OrdersScreen';
import { SubscriptionsScreen } from '../screens/customer/SubscriptionsScreen';
import { CartScreen } from '../screens/customer/CartScreen';
import { CheckoutScreen } from '../screens/customer/CheckoutScreen';
import { OrderDetailScreen } from '../screens/customer/OrderDetailScreen';
import { AddressesScreen } from '../screens/customer/AddressesScreen';
import { AddAddressScreen } from '../screens/customer/AddAddressScreen';
import { PlanDetailScreen } from '../screens/customer/PlanDetailScreen';
import { SubscriptionDetailScreen } from '../screens/customer/SubscriptionDetailScreen';
import { WalletScreen } from '../screens/customer/WalletScreen';
import { ReferralScreen } from '../screens/customer/ReferralScreen';
import { EssentialsScreen } from '../screens/customer/EssentialsScreen';
import { FeedbackScreen } from '../screens/customer/FeedbackScreen';
import { PlansScreen } from '../screens/customer/PlansScreen';
import { LoyaltyPointsScreen } from '../screens/customer/LoyaltyPointsScreen';
import { Theme } from '../theme';

const Stack = createNativeStackNavigator();

export function CustomerNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Theme.colors.background.primary },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Orders" component={OrdersScreen} />
      <Stack.Screen name="Subscriptions" component={SubscriptionsScreen} />
      <Stack.Screen name="Cart" component={CartScreen} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
      <Stack.Screen name="Addresses" component={AddressesScreen} />
      <Stack.Screen name="AddAddress" component={AddAddressScreen} />
      <Stack.Screen name="PlanDetail" component={PlanDetailScreen} />
      <Stack.Screen name="SubscriptionDetail" component={SubscriptionDetailScreen} />
      <Stack.Screen
        name="Wallet"
        component={WalletScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen name="Referral" component={ReferralScreen} />
      <Stack.Screen name="Essentials" component={EssentialsScreen} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} />
      <Stack.Screen
        name="Plans"
        component={PlansScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="LoyaltyPoints"
        component={LoyaltyPointsScreen}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}
