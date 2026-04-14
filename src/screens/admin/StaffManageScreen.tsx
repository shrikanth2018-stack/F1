/**
 * 1stOne F1 — Admin Staff Management Screen
 *
 * View all staff, today's attendance, expense approvals, leave approvals.
 * Segmented: Staff List | Attendance | Expenses | Leaves
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import {
  useAllStaff,
  useAllStaffAttendance,
  useAllExpenseClaims,
  useAllLeaveRequests,
  useReviewExpense,
  useReviewLeave,
} from '../../hooks/useStaffManagement';

type Tab = 'staff' | 'attendance' | 'expenses' | 'leaves';

function formatTime(iso: string | null): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function StaffManageScreen({ navigation }: { navigation: any }) {
  const [activeTab, setActiveTab] = useState<Tab>('staff');

  const { data: staffList } = useAllStaff();
  const { data: attendance } = useAllStaffAttendance();
  const { data: expenses } = useAllExpenseClaims('Pending');
  const { data: leaves } = useAllLeaveRequests('Pending');
  const reviewExpense = useReviewExpense();
  const reviewLeave = useReviewLeave();

  const handleExpenseReview = useCallback(
    (claimId: number, status: 'Approved' | 'Rejected') => {
      Alert.alert(
        `${status} Expense`,
        `${status === 'Approved' ? 'Approve' : 'Reject'} this claim?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: status, onPress: () => reviewExpense.mutate({ claimId, status }) },
        ]
      );
    },
    [reviewExpense]
  );

  const handleLeaveReview = useCallback(
    (leaveId: number, status: 'Approved' | 'Rejected') => {
      Alert.alert(
        `${status} Leave`,
        `${status === 'Approved' ? 'Approve' : 'Reject'} this request?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: status, onPress: () => reviewLeave.mutate({ leaveId, status }) },
        ]
      );
    },
    [reviewLeave]
  );

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'staff', label: 'Staff', count: staffList?.length ?? 0 },
    { key: 'attendance', label: 'Today', count: attendance?.length ?? 0 },
    { key: 'expenses', label: 'Expenses', count: expenses?.length ?? 0 },
    { key: 'leaves', label: 'Leaves', count: leaves?.length ?? 0 },
  ];

  const renderStaffItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <ThemedText variant="body" color="primary" style={styles.txt}>
        {item.full_name || 'Unnamed'}
      </ThemedText>
      <ThemedText variant="small" color="subtitle" style={styles.sub}>
        {item.phone_number}
      </ThemedText>
      {item.assigned_hub_id && (
        <ThemedText variant="small" color="muted" style={styles.sub}>
          Hub: {item.assigned_hub_id}
        </ThemedText>
      )}
    </View>
  );

  const renderAttendanceItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <ThemedText variant="body" color="primary" style={styles.txt}>
        {item.profiles?.full_name || item.profiles?.phone_number || 'Staff'}
      </ThemedText>
      <View style={styles.timeRow}>
        <ThemedText variant="small" color="subtitle" style={styles.sub}>
          In: {formatTime(item.clock_in_time)}
        </ThemedText>
        <ThemedText variant="small" color="subtitle" style={styles.sub}>
          Out: {formatTime(item.clock_out_time)}
        </ThemedText>
      </View>
    </View>
  );

  const renderExpenseItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.cardInfo}>
          <ThemedText variant="body" color="primary" style={styles.txt}>
            {item.profiles?.full_name || 'Staff'}
          </ThemedText>
          <ThemedText variant="small" color="subtitle" style={styles.sub}>
            {item.category} — {'₹'}{item.amount}
          </ThemedText>
          <ThemedText variant="small" color="muted" style={styles.sub}>
            {item.description}
          </ThemedText>
        </View>
        <View style={styles.reviewBtns}>
          <TouchableOpacity
            style={styles.approveBtn}
            onPress={() => handleExpenseReview(item.id, 'Approved')}
          >
            <ThemedText variant="small" color="primary" style={styles.sub}>Approve</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.rejectBtn}
            onPress={() => handleExpenseReview(item.id, 'Rejected')}
          >
            <ThemedText variant="small" color="primary" style={styles.sub}>Reject</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const renderLeaveItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.cardInfo}>
          <ThemedText variant="body" color="primary" style={styles.txt}>
            {item.profiles?.full_name || 'Staff'}
          </ThemedText>
          <ThemedText variant="small" color="subtitle" style={styles.sub}>
            {item.start_date} to {item.end_date}
          </ThemedText>
          {item.reason && (
            <ThemedText variant="small" color="muted" style={styles.sub}>
              {item.reason}
            </ThemedText>
          )}
        </View>
        <View style={styles.reviewBtns}>
          <TouchableOpacity
            style={styles.approveBtn}
            onPress={() => handleLeaveReview(item.id, 'Approved')}
          >
            <ThemedText variant="small" color="primary" style={styles.sub}>Approve</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.rejectBtn}
            onPress={() => handleLeaveReview(item.id, 'Rejected')}
          >
            <ThemedText variant="small" color="primary" style={styles.sub}>Reject</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const getListData = () => {
    switch (activeTab) {
      case 'staff': return { data: staffList ?? [], render: renderStaffItem, empty: 'No staff members' };
      case 'attendance': return { data: attendance ?? [], render: renderAttendanceItem, empty: 'No attendance today' };
      case 'expenses': return { data: expenses ?? [], render: renderExpenseItem, empty: 'No pending expenses' };
      case 'leaves': return { data: leaves ?? [], render: renderLeaveItem, empty: 'No pending leave requests' };
    }
  };

  const listConfig = getListData();

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>
            ‹ Back
          </ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.headerTitle}>
          Team
        </ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <ThemedText
              variant="small"
              color={activeTab === t.key ? 'primary' : 'subtitle'}
              style={styles.tabTxt}
            >
              {t.label} ({t.count})
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      <FlatList
        data={listConfig.data}
        keyExtractor={(item: any) => String(item.id)}
        renderItem={listConfig.render}
        ListEmptyComponent={<EmptyState title={listConfig.empty} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  headerTitle: { flex: 1, textAlign: 'center' },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.sm,
    gap: Theme.spacing.xs,
    marginBottom: Theme.spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: Theme.spacing.sm,
    borderRadius: 8,
    backgroundColor: Theme.colors.background.tertiary,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: Theme.colors.action.primary,
  },
  list: {
    padding: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },
  card: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardInfo: {
    flex: 1,
    marginRight: Theme.spacing.sm,
  },
  timeRow: {
    flexDirection: 'row',
    gap: Theme.spacing.lg,
    marginTop: Theme.spacing.xs,
  },
  reviewBtns: {
    gap: Theme.spacing.xs,
  },
  approveBtn: {
    backgroundColor: Theme.colors.status.success,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 6,
    alignItems: 'center',
  },
  rejectBtn: {
    backgroundColor: Theme.colors.status.error,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 6,
    alignItems: 'center',
  },
  txt: { fontSize: B },
  sub: { fontSize: S },
  tabTxt: { fontSize: S },
});
