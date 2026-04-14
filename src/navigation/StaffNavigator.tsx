/**
 * 1stOne F1 — Staff Navigator
 *
 * Per blueprint: NO bottom tabs for staff.
 * StaffDashboard is the main screen with Kitchen/Packing/Delivery
 * as top tabs built into the dashboard itself.
 *
 * Stack pushes:
 *   - Attendance (from header profile button)
 *   - Expenses (from footer shortcuts or profile)
 *   - StaffProfile (from header profile button)
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StaffDashboard } from '../screens/staff/StaffDashboard';
import { StaffAttendanceScreen } from '../screens/staff/StaffAttendanceScreen';
import { StaffExpensesScreen } from '../screens/staff/StaffExpensesScreen';
import { StaffProfileScreen } from '../screens/staff/StaffProfileScreen';
import { StaffLeaveScreen } from '../screens/staff/StaffLeaveScreen';
import { Theme } from '../theme';

const Stack = createNativeStackNavigator();

export function StaffNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Theme.colors.background.primary },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="StaffDashboard" component={StaffDashboard} />
      <Stack.Screen name="Attendance" component={StaffAttendanceScreen} />
      <Stack.Screen name="StaffExpenses" component={StaffExpensesScreen} />
      <Stack.Screen name="StaffProfile" component={StaffProfileScreen} />
      <Stack.Screen name="StaffLeave"   component={StaffLeaveScreen} />
    </Stack.Navigator>
  );
}
