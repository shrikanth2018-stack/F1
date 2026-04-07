/**
 * 1stOne F1 — Staff Attendance Screen
 *
 * Clock in/out with GPS, monthly attendance calendar,
 * leave request submission.
 * All mutations offline-aware.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  StyleSheet,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { EmptyState } from '../../components/EmptyState';
import {
  useTodayAttendance,
  useAttendanceHistory,
  useClockIn,
  useClockOut,
  useStaffLeaves,
  useRequestLeave,
} from '../../hooks/useAttendance';

function formatTime(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function getHoursWorked(clockIn: string | null, clockOut: string | null): string {
  if (!clockIn || !clockOut) return '-';
  const diff = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hrs}h ${mins}m`;
}

export function StaffAttendanceScreen() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');

  const { data: todayRecord, isLoading: todayLoading } = useTodayAttendance();
  const { data: history } = useAttendanceHistory(month, year);
  const { data: leaves } = useStaffLeaves();
  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const requestLeave = useRequestLeave();

  const isClockedIn = !!todayRecord?.clock_in_time && !todayRecord?.clock_out_time;
  const isClockedOut = !!todayRecord?.clock_out_time;

  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const daysPresent = useMemo(
    () => (history ?? []).filter((r) => r.clock_in_time).length,
    [history]
  );

  const handleClockIn = () => {
    Alert.alert('Clock In', 'Your GPS location will be recorded. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clock In', onPress: () => clockIn.mutate() },
    ]);
  };

  const handleClockOut = () => {
    Alert.alert('Clock Out', 'Confirm clock out for today?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clock Out', onPress: () => clockOut.mutate() },
    ]);
  };

  const handleLeaveSubmit = () => {
    if (!leaveStart || !leaveEnd) {
      Alert.alert('Error', 'Please enter start and end dates (YYYY-MM-DD)');
      return;
    }
    requestLeave.mutate(
      { startDate: leaveStart, endDate: leaveEnd, reason: leaveReason || undefined },
      {
        onSuccess: () => {
          setShowLeaveForm(false);
          setLeaveStart('');
          setLeaveEnd('');
          setLeaveReason('');
          Alert.alert('Submitted', 'Leave request sent for approval.');
        },
      }
    );
  };

  const prevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };

  const nextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <ThemedText variant="header" color="primary">
        Attendance
      </ThemedText>

      {/* Today's Status Card */}
      <View style={styles.todayCard}>
        <ThemedText variant="subtitle" color="primary">
          Today
        </ThemedText>

        <View style={styles.clockRow}>
          <View style={styles.clockCol}>
            <ThemedText variant="small" color="subtitle">
              Clock In
            </ThemedText>
            <ThemedText variant="subtitle" color="primary">
              {formatTime(todayRecord?.clock_in_time ?? null)}
            </ThemedText>
          </View>

          <View style={styles.clockCol}>
            <ThemedText variant="small" color="subtitle">
              Clock Out
            </ThemedText>
            <ThemedText variant="subtitle" color="primary">
              {formatTime(todayRecord?.clock_out_time ?? null)}
            </ThemedText>
          </View>

          <View style={styles.clockCol}>
            <ThemedText variant="small" color="subtitle">
              Hours
            </ThemedText>
            <ThemedText variant="subtitle" color="primary">
              {getHoursWorked(
                todayRecord?.clock_in_time ?? null,
                todayRecord?.clock_out_time ?? null
              )}
            </ThemedText>
          </View>
        </View>

        {/* Clock In/Out Button */}
        {!todayRecord?.clock_in_time && (
          <ThemedButton
            title="Clock In"
            variant="primary"
            onPress={handleClockIn}
            loading={clockIn.isPending || todayLoading}
          />
        )}

        {isClockedIn && (
          <ThemedButton
            title="Clock Out"
            variant="primary"
            onPress={handleClockOut}
            loading={clockOut.isPending}
          />
        )}

        {isClockedOut && (
          <View style={styles.doneBadge}>
            <ThemedText variant="small" color="primary">
              Shift Complete
            </ThemedText>
          </View>
        )}
      </View>

      {/* Monthly History */}
      <View style={styles.section}>
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={prevMonth}>
            <ThemedText variant="subtitle" color="accent">
              {'<'}
            </ThemedText>
          </TouchableOpacity>
          <ThemedText variant="subtitle" color="primary">
            {monthLabel}
          </ThemedText>
          <TouchableOpacity onPress={nextMonth}>
            <ThemedText variant="subtitle" color="accent">
              {'>'}
            </ThemedText>
          </TouchableOpacity>
        </View>

        <ThemedText variant="small" color="subtitle" style={styles.summary}>
          Days present: {daysPresent} / {history?.length ?? 0} records
        </ThemedText>

        {(history ?? []).length === 0 ? (
          <EmptyState message="No attendance records this month" />
        ) : (
          (history ?? []).map((record) => (
            <View key={record.id} style={styles.historyRow}>
              <ThemedText variant="small" color="primary" style={styles.historyDate}>
                {record.date}
              </ThemedText>
              <ThemedText variant="small" color="subtitle">
                {formatTime(record.clock_in_time)} — {formatTime(record.clock_out_time)}
              </ThemedText>
              <ThemedText variant="small" color="muted">
                {getHoursWorked(record.clock_in_time, record.clock_out_time)}
              </ThemedText>
            </View>
          ))
        )}
      </View>

      {/* Leave Requests */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ThemedText variant="subtitle" color="primary">
            Leave Requests
          </ThemedText>
          <TouchableOpacity onPress={() => setShowLeaveForm(!showLeaveForm)}>
            <ThemedText variant="small" color="accent">
              {showLeaveForm ? 'Cancel' : '+ New'}
            </ThemedText>
          </TouchableOpacity>
        </View>

        {showLeaveForm && (
          <View style={styles.leaveForm}>
            <TextInput
              style={styles.input}
              placeholder="Start date (YYYY-MM-DD)"
              placeholderTextColor={Theme.colors.text.muted}
              value={leaveStart}
              onChangeText={setLeaveStart}
            />
            <TextInput
              style={styles.input}
              placeholder="End date (YYYY-MM-DD)"
              placeholderTextColor={Theme.colors.text.muted}
              value={leaveEnd}
              onChangeText={setLeaveEnd}
            />
            <TextInput
              style={[styles.input, styles.reasonInput]}
              placeholder="Reason (optional)"
              placeholderTextColor={Theme.colors.text.muted}
              value={leaveReason}
              onChangeText={setLeaveReason}
              multiline
            />
            <ThemedButton
              title="Submit Leave Request"
              variant="primary"
              onPress={handleLeaveSubmit}
              loading={requestLeave.isPending}
            />
          </View>
        )}

        {(leaves ?? []).length === 0 && !showLeaveForm ? (
          <EmptyState message="No leave requests" />
        ) : (
          (leaves ?? []).map((leave) => (
            <View key={leave.id} style={styles.leaveRow}>
              <View style={styles.leaveInfo}>
                <ThemedText variant="small" color="primary">
                  {leave.start_date} to {leave.end_date}
                </ThemedText>
                {leave.reason && (
                  <ThemedText variant="small" color="muted">
                    {leave.reason}
                  </ThemedText>
                )}
              </View>
              <View
                style={[
                  styles.leaveStatus,
                  {
                    backgroundColor:
                      leave.status === 'Approved'
                        ? Theme.colors.status.success
                        : leave.status === 'Rejected'
                        ? Theme.colors.status.error
                        : Theme.colors.status.warning,
                  },
                ]}
              >
                <ThemedText variant="micro" color="primary">
                  {leave.status}
                </ThemedText>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  content: {
    padding: Theme.spacing.md,
    paddingTop: Theme.spacing.xl + Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },
  todayCard: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    marginTop: Theme.spacing.md,
  },
  clockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: Theme.spacing.md,
  },
  clockCol: {
    alignItems: 'center',
  },
  doneBadge: {
    backgroundColor: Theme.colors.status.success,
    paddingVertical: Theme.spacing.sm,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: Theme.spacing.sm,
  },
  section: {
    marginTop: Theme.spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  summary: {
    marginBottom: Theme.spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.layout.divider,
  },
  historyDate: {
    minWidth: 90,
  },
  leaveForm: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
  },
  input: {
    backgroundColor: Theme.colors.background.input,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    marginBottom: Theme.spacing.sm,
  },
  reasonInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  leaveRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.layout.divider,
  },
  leaveInfo: {
    flex: 1,
    marginRight: Theme.spacing.sm,
  },
  leaveStatus: {
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
  },
});
