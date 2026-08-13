/**
 * 1stOne F1 — Employee Detail Screen (Admin)
 *
 * 4 tabs for a single staff member:
 *   Profile    — view / inline-edit basic info
 *   Attendance — month calendar (P / A / L) + clock-in/out list
 *   Leave      — pending approvals + history
 *   Salary     — monthly salary cards + mark paid + add record
 */

import React, { useState } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Divider } from '../../components/Divider';
import { useEmployeeLeaves } from '../../hooks/useResourceManager';
import { useAllStaff } from '../../hooks/useStaffManagement';
import type { Profile } from '../../types';
import type { AdminScreenProps } from '../../navigation/types';
import { ProfileTab } from './components/ProfileTab';
import { AttendanceTab } from './components/AttendanceTab';
import { LeaveTab } from './components/LeaveTab';
import { SalaryTab } from './components/SalaryTab';

const B = Theme.typography.sizes.body + 2;

type DetailTab = 'Profile' | 'Attendance' | 'Leave' | 'Salary';
const DETAIL_TABS: DetailTab[] = ['Profile', 'Attendance', 'Leave', 'Salary'];

// ── Main screen ───────────────────────────────────────────────
export function EmployeeDetailScreen({ navigation, route }: AdminScreenProps<'EmployeeDetail'>) {
  const { staffId } = route.params;
  const [activeTab, setActiveTab] = useState<DetailTab>('Profile');

  const { data: allStaff = [] } = useAllStaff();
  const staff = allStaff.find((s) => s.id === staffId) as Profile | undefined;

  // Pre-fetch leaves for attendance tab cross-reference
  const { data: leaves = [] } = useEmployeeLeaves(staffId);

  if (!staff) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Theme.colors.text.mint} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <ScreenHeader title={staff.full_name || staff.phone_number} />

      {/* ── Who this is, beneath the name ──
           This used to be a second line INSIDE the header. `ScreenHeader` is
           one height on every page — that is the whole reason it exists, so a
           title never lands a few points off where the last page put it — and
           a subtitle slot would have given that away for one screen. The
           employee number and designation are what an admin checks they have
           opened the right person by, so they stay; they simply sit under the
           bar instead of in it. */}
      {!!(staff.employee_id || staff.designation) && (
        <ThemedText variant="small" color="muted" style={styles.identity}>
          {[staff.employee_id, staff.designation].filter(Boolean).join('  ·  ')}
        </ThemedText>
      )}

      {/* Tabs */}
      <View style={styles.tabRow}>
        {DETAIL_TABS.map((t, i) => (
          <React.Fragment key={t}>
            {i > 0 && (
              <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>
            )}
            <TouchableOpacity onPress={() => setActiveTab(t)}>
              <ThemedText
                variant="body"
                color={activeTab === t ? 'primary' : 'muted'}
                style={[styles.tabTxt, activeTab === t && styles.tabActive]}
              >
                {t}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      <Divider />

      {/* Tab content */}
      {activeTab === 'Profile'    && <ProfileTab staff={staff} navigation={navigation} />}
      {activeTab === 'Attendance' && <AttendanceTab staffId={staffId} leaves={leaves} />}
      {activeTab === 'Leave'      && <LeaveTab staffId={staffId} />}
      {activeTab === 'Salary'     && <SalaryTab staffId={staffId} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  identity: { paddingHorizontal: Theme.spacing.md, paddingTop: Theme.spacing.sm },

  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  pipe:      { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  tabTxt:    { fontSize: B },
  tabActive: {  },
});
