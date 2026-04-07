/**
 * 1stOne F1 — Staff Navigator
 *
 * Stack wrapping bottom tabs for modal screens.
 * Tabs: Dashboard | Attendance | Expenses | Profile
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StaffDashboard } from '../screens/staff/StaffDashboard';
import { StaffAttendanceScreen } from '../screens/staff/StaffAttendanceScreen';
import { StaffExpensesScreen } from '../screens/staff/StaffExpensesScreen';
import { StaffProfileScreen } from '../screens/staff/StaffProfileScreen';
import { Theme } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function StaffTabs() {
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
      <Tab.Screen name="Dashboard" component={StaffDashboard} />
      <Tab.Screen name="Attendance" component={StaffAttendanceScreen} />
      <Tab.Screen name="Expenses" component={StaffExpensesScreen} />
      <Tab.Screen name="Profile" component={StaffProfileScreen} />
    </Tab.Navigator>
  );
}

export function StaffNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Theme.colors.background.primary },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="StaffTabs" component={StaffTabs} />
    </Stack.Navigator>
  );
}
