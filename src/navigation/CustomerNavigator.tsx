/**
 * 1stOne F1 — Customer Navigator
 *
 * Stack wrapping bottom tabs for modal screens.
 * Tabs: Home | Orders | Subscribe | Profile
 * Stack screens: Cart, Checkout, OrderDetail, AddAddress
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/customer/HomeScreen';
import { OrdersScreen } from '../screens/customer/OrdersScreen';
import { SubscriptionsScreen } from '../screens/customer/SubscriptionsScreen';
import { ProfileScreen } from '../screens/customer/ProfileScreen';
import { CartScreen } from '../screens/customer/CartScreen';
import { CheckoutScreen } from '../screens/customer/CheckoutScreen';
import { OrderDetailScreen } from '../screens/customer/OrderDetailScreen';
import { AddAddressScreen } from '../screens/customer/AddAddressScreen';
import { PlanDetailScreen } from '../screens/customer/PlanDetailScreen';
import { SubscriptionDetailScreen } from '../screens/customer/SubscriptionDetailScreen';
import { WalletScreen } from '../screens/customer/WalletScreen';
import { ReferralScreen } from '../screens/customer/ReferralScreen';
import { EssentialsScreen } from '../screens/customer/EssentialsScreen';
import { FeedbackScreen } from '../screens/customer/FeedbackScreen';
import { Theme } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function CustomerTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Theme.colors.background.card,
          borderTopColor: Theme.colors.layout.divider,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: Theme.colors.action.primary,
        tabBarInactiveTintColor: Theme.colors.text.muted,
        tabBarLabelStyle: {
          fontFamily: Theme.typography.fontFamily,
          fontSize: Theme.typography.sizes.micro,
        },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Orders" component={OrdersScreen} />
      <Tab.Screen
        name="Subscriptions"
        component={SubscriptionsScreen}
        options={{ tabBarLabel: 'Subscribe' }}
      />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export function CustomerNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Theme.colors.background.primary },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="CustomerTabs" component={CustomerTabs} />
      <Stack.Screen name="Cart" component={CartScreen} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
      <Stack.Screen name="AddAddress" component={AddAddressScreen} />
      <Stack.Screen name="PlanDetail" component={PlanDetailScreen} />
      <Stack.Screen name="SubscriptionDetail" component={SubscriptionDetailScreen} />
      <Stack.Screen name="Wallet" component={WalletScreen} />
      <Stack.Screen name="Referral" component={ReferralScreen} />
      <Stack.Screen name="Essentials" component={EssentialsScreen} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} />
    </Stack.Navigator>
  );
}
