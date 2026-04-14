/**
 * 1stOne F1 — Staff Profile Screen
 *
 * Shows:
 *  - Employee identity (ID, designation, shift, joining date)
 *  - Current month salary summary (if record exists)
 *  - Benefits enrolled in
 *  - Quick links: My Leaves, My Expenses
 *  - Sync status
 */

import React from 'react';
import {
  View,
  ScrollView,
  Alert,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { useAuth } from '../../hooks/useAuth';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../api/supabaseClient';
import { QUERY_STALE_TIME } from '../../utils/constants';
import type { Profile, StaffSalary } from '../../types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText variant="body" color="muted" style={{ fontSize: B }}>{label}</ThemedText>
      <ThemedText variant="body" color="primary" style={{ fontSize: B, textAlign: 'right', flex: 1 }}>
        {value}
      </ThemedText>
    </View>
  );
}

function NavRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.navRow} onPress={onPress} activeOpacity={0.7}>
      <ThemedText variant="body" color="primary" style={{ fontSize: B }}>{label}</ThemedText>
      <ThemedText variant="body" color="accent" style={{ fontSize: B + 4, opacity: 0.5 }}>›</ThemedText>
    </TouchableOpacity>
  );
}

export function StaffProfileScreen() {
  const navigation = useNavigation<any>();
  const { session, signOut } = useAuth();
  const { pendingCount, isSyncing, manualSync } = useOfflineSync();

  // Fetch own profile for staff-specific fields
  const { data: profile } = useQuery<Profile | null>({
    queryKey: ['staff_profile', session?.user.id],
    queryFn: async () => {
      if (!session) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      if (error) return null;
      return data as Profile;
    },
    enabled: !!session,
    staleTime: QUERY_STALE_TIME,
  });

  // Current month salary
  const now = new Date();
  const { data: salary } = useQuery<StaffSalary | null>({
    queryKey: ['staff_salary_current', session?.user.id, now.getFullYear(), now.getMonth() + 1],
    queryFn: async () => {
      if (!session) return null;
      const { data } = await supabase
        .from('staff_salary')
        .select('*')
        .eq('staff_id', session.user.id)
        .eq('year', now.getFullYear())
        .eq('month', now.getMonth() + 1)
        .maybeSingle();
      return (data as StaffSalary) ?? null;
    },
    enabled: !!session,
    staleTime: QUERY_STALE_TIME,
  });

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const displayName = profile?.full_name || session?.user.phone || 'Staff Member';
  const benefits    = profile?.benefits
    ? profile.benefits.split(',').map((b) => b.trim()).filter(Boolean)
    : [];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={{ fontSize: B }}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>My Profile</ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Name */}
        <View style={styles.nameBlock}>
          <ThemedText variant="title" color="mint" style={styles.name}>{displayName}</ThemedText>
          {!!profile?.designation && (
            <ThemedText variant="body" color="muted" style={styles.desig}>{profile.designation}</ThemedText>
          )}
        </View>

        <Divider />

        {/* Employee Details */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>EMPLOYEE DETAILS</ThemedText>
        <InfoRow label="Employee ID"  value={profile?.employee_id  ?? '—'} />
        <InfoRow label="Phone"        value={session?.user.phone   ?? '—'} />
        <InfoRow label="Shift"        value={profile?.shift_timing ? profile.shift_timing.split('  ')[0] : '—'} />
        <InfoRow label="Joining Date" value={profile?.joining_date ? new Date(profile.joining_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} />

        {/* Benefits */}
        {benefits.length > 0 && (
          <>
            <Divider />
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>BENEFITS</ThemedText>
            <View style={styles.benefitsRow}>
              {benefits.map((b) => (
                <View key={b} style={styles.benefitChip}>
                  <ThemedText variant="small" color="mint" style={{ fontSize: S }}>{b}</ThemedText>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Current Month Salary */}
        {salary && (
          <>
            <Divider />
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
              {new Date(now.getFullYear(), now.getMonth()).toLocaleString('en-IN', { month: 'long', year: 'numeric' }).toUpperCase()}  SALARY
            </ThemedText>
            <InfoRow label="Base"       value={`₹${salary.base_salary.toLocaleString('en-IN')}`} />
            {salary.deductions > 0 && (
              <InfoRow label="Deductions" value={`– ₹${salary.deductions.toLocaleString('en-IN')}`} />
            )}
            {salary.bonus > 0 && (
              <InfoRow label="Bonus"      value={`+ ₹${salary.bonus.toLocaleString('en-IN')}`} />
            )}
            <View style={styles.detailRow}>
              <ThemedText variant="body" color="muted" style={{ fontSize: B }}>Net Salary</ThemedText>
              <ThemedText variant="body" color="primary" style={{ fontSize: B + 2, fontWeight: '600' }}>
                ₹{salary.net_salary.toLocaleString('en-IN')}
              </ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText variant="body" color="muted" style={{ fontSize: B }}>Status</ThemedText>
              <ThemedText
                variant="body"
                color="muted"
                style={{ fontSize: B, color: salary.is_paid ? Theme.colors.text.mint : Theme.colors.status.warning }}
              >
                {salary.is_paid ? `Paid${salary.paid_at ? '  · ' + new Date(salary.paid_at).toLocaleDateString('en-IN') : ''}` : 'Pending'}
              </ThemedText>
            </View>
          </>
        )}

        <Divider />

        {/* Quick links */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>MY REQUESTS</ThemedText>
        <NavRow label="My Leaves" onPress={() => navigation.navigate('StaffLeave')} />

        <Divider />

        {/* Sync */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>SYNC STATUS</ThemedText>
        <InfoRow
          label="Pending updates"
          value={pendingCount > 0 ? `${pendingCount} queued` : 'All synced'}
        />
        {pendingCount > 0 && (
          <TouchableOpacity onPress={manualSync} disabled={isSyncing} style={styles.syncLink}>
            <ThemedText variant="body" color="mint" style={{ fontSize: B }}>
              {isSyncing ? 'Syncing…' : 'Sync now  ›'}
            </ThemedText>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="muted" style={{ fontSize: B }}>Close</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleSignOut}>
          <ThemedText
            variant="body"
            color="muted"
            style={{ fontSize: B, color: Theme.colors.status.error }}
          >
            Sign Out
          </ThemedText>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  title: { flex: 1, textAlign: 'center' },

  scroll: { paddingBottom: Theme.spacing.xl * 2 },

  nameBlock: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
  },
  name:  { marginBottom: 4 },
  desig: { fontSize: B },

  sectionLabel: {
    fontSize: S,
    letterSpacing: 1,
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },

  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  benefitsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  benefitChip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },

  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  syncLink: {
    alignSelf: 'flex-end',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
});
