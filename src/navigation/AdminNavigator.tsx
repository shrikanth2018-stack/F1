/**
 * 1stOne F1 — Admin Navigator
 *
 * Stack wrapping bottom tabs + pushed management/report screens.
 * Tabs: Dashboard | Orders | Reports | Manage
 * Stack pushes: MenuManage, StaffManage, StoreConfig,
 *               OrderReport, SubscriptionReport, StaffReport
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AdminDashboard } from '../screens/admin/AdminDashboard';
import { AdminOrdersScreen } from '../screens/admin/AdminOrdersScreen';
import { ManageScreen } from '../screens/admin/ManageScreen';
import { MenuManageScreen } from '../screens/admin/MenuManageScreen';
import { StaffManageScreen } from '../screens/admin/StaffManageScreen';
import { StoreConfigScreen } from '../screens/admin/StoreConfigScreen';
import { ReportsDashboard } from '../screens/admin/reports/ReportsDashboard';
import { OrderReportScreen } from '../screens/admin/reports/OrderReportScreen';
import { SubscriptionReportScreen } from '../screens/admin/reports/SubscriptionReportScreen';
import { StaffReportScreen } from '../screens/admin/reports/StaffReportScreen';
import { Theme } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function AdminTabs() {
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
      <Tab.Screen name="Dashboard" component={AdminDashboard} />
      <Tab.Screen name="Orders" component={AdminOrdersScreen} />
      <Tab.Screen name="Reports" component={ReportsDashboard} />
      <Tab.Screen name="Manage" component={ManageScreen} />
    </Tab.Navigator>
  );
}

export function AdminNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Theme.colors.background.primary },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="AdminTabs" component={AdminTabs} />
      <Stack.Screen name="MenuManage" component={MenuManageScreen} />
      <Stack.Screen name="StaffManage" component={StaffManageScreen} />
      <Stack.Screen name="StoreConfig" component={StoreConfigScreen} />
      <Stack.Screen name="OrderReport" component={OrderReportScreen} />
      <Stack.Screen name="SubscriptionReport" component={SubscriptionReportScreen} />
      <Stack.Screen name="StaffReport" component={StaffReportScreen} />
    </Stack.Navigator>
  );
}
