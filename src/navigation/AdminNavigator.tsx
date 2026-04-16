/**
 * 1stOne F1 — Admin Navigator
 *
 * Per blueprint: Single stack. Root is AdminHome (2-tab: Reports | Manage).
 * Each "Manage" row navigates into its own deep screen via this stack.
 * No bottom tabs — tabs are handled inline inside AdminHome.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AdminHome } from '../screens/admin/AdminHome';
import { MenuManageScreen } from '../screens/admin/MenuManageScreen';
import { CreateMenuScreen } from '../screens/admin/CreateMenuScreen';
import { CreatePlanScreen } from '../screens/admin/CreatePlanScreen';
import { DeliveryManagerScreen } from '../screens/admin/DeliveryManagerScreen';
import { PlansManageScreen } from '../screens/admin/PlansManageScreen';
import { ResourceManagerScreen } from '../screens/admin/ResourceManagerScreen';
import { EmployeeDetailScreen } from '../screens/admin/EmployeeDetailScreen';
import { OnboardEmployeeScreen } from '../screens/admin/OnboardEmployeeScreen';
import { StoreConfigScreen } from '../screens/admin/StoreConfigScreen';
import { FeatureFlagsScreen } from '../screens/admin/FeatureFlagsScreen';
import { EssentialsCatalogManageScreen } from '../screens/admin/EssentialsCatalogManageScreen';
import { CreateEssentialScreen } from '../screens/admin/CreateEssentialScreen';
import { ImportItemsScreen } from '../screens/admin/ImportItemsScreen';
import { NoteToStaffScreen } from '../screens/admin/NoteToStaffScreen';
import { SpecialOfferBannerScreen } from '../screens/admin/SpecialOfferBannerScreen';
import { CustomerFeedbackScreen } from '../screens/admin/CustomerFeedbackScreen';
import { ReferralSettingsScreen } from '../screens/admin/ReferralSettingsScreen';
import { ExpenseManagerScreen } from '../screens/admin/ExpenseManagerScreen';
import { StockManagerScreen } from '../screens/admin/StockManagerScreen';
import { HubDetailScreen } from '../screens/admin/HubDetailScreen';
import { OrderReportScreen } from '../screens/admin/reports/OrderReportScreen';
import { RevenueReportScreen } from '../screens/admin/reports/RevenueReportScreen';
import { SubscriptionReportScreen } from '../screens/admin/reports/SubscriptionReportScreen';
import { StaffReportScreen } from '../screens/admin/reports/StaffReportScreen';
import { Theme } from '../theme';
import { ThemedText } from '../components/ThemedText';

const Stack = createNativeStackNavigator();

const B = Theme.typography.sizes.body + 2;

/** Placeholder for screens not yet built — shows the title + "Coming soon" */
function PlaceholderScreen({ route, navigation }: { route: any; navigation: any }) {
  return (
    <SafeAreaView style={placeholder.container}>
      <View style={placeholder.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={placeholder.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={placeholder.title}>{route.name}</ThemedText>
        <View style={placeholder.spacer} />
      </View>
      <ThemedText variant="body" color="muted" style={placeholder.sub}>Coming soon</ThemedText>
    </SafeAreaView>
  );
}

const placeholder = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },
  sub: { marginTop: Theme.spacing.md, paddingHorizontal: Theme.spacing.md, fontSize: B },
});

export function AdminNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Theme.colors.background.primary },
        animation: 'slide_from_right',
      }}
    >
      {/* Root */}
      <Stack.Screen name="AdminHome" component={AdminHome} />

      {/* Reports drill-downs */}
      <Stack.Screen name="OrderReport" component={OrderReportScreen} />
      <Stack.Screen name="RevenueReport" component={RevenueReportScreen} />
      <Stack.Screen name="SubscriptionReport" component={SubscriptionReportScreen} />
      <Stack.Screen name="StaffReport" component={StaffReportScreen} />

      {/* Manage — Menu */}
      <Stack.Screen name="MenuManage" component={MenuManageScreen} />
      <Stack.Screen name="CreateMenu" component={CreateMenuScreen} />
      <Stack.Screen name="CreatePlan" component={CreatePlanScreen} />
      <Stack.Screen name="PlansManage" component={PlansManageScreen} />
      <Stack.Screen name="EssentialsCatalogManage" component={EssentialsCatalogManageScreen} />
      <Stack.Screen name="CreateEssential" component={CreateEssentialScreen} />
      <Stack.Screen name="ImportItems" component={ImportItemsScreen} />

      {/* Manage — Delivery */}
      <Stack.Screen name="DeliveryManage" component={DeliveryManagerScreen} />
      <Stack.Screen name="HubDetail" component={HubDetailScreen} />

      {/* Manage — Resource (Staff) */}
      <Stack.Screen name="ResourceManager" component={ResourceManagerScreen} />
      <Stack.Screen name="EmployeeDetail" component={EmployeeDetailScreen} />
      <Stack.Screen name="OnboardEmployee" component={OnboardEmployeeScreen} />

      {/* Manage — Notifications */}
      <Stack.Screen name="PushNotifications" component={NoteToStaffScreen} />
      <Stack.Screen name="CustomerPush" component={SpecialOfferBannerScreen} />

      {/* Manage — Marketing */}
      <Stack.Screen name="ReferralSettings" component={ReferralSettingsScreen} />
      <Stack.Screen name="CustomerFeedback" component={CustomerFeedbackScreen} />

      {/* Manage — Finance */}
      <Stack.Screen name="ExpenseManager" component={ExpenseManagerScreen} />
      <Stack.Screen name="StockManager" component={StockManagerScreen} />

      {/* Manage — Operations */}
      <Stack.Screen name="StoreConfig" component={StoreConfigScreen} />
      <Stack.Screen name="FeatureFlags" component={FeatureFlagsScreen} />
    </Stack.Navigator>
  );
}
