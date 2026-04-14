/**
 * 1stOne F1 — Staff Attendance Screen
 * Plain text, thin mint hairlines. No back button (accessed from profile popup).
 * Calendar date picker for leave start/end.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  StyleSheet,
  Modal,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
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
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function getHoursWorked(clockIn: string | null, clockOut: string | null): string {
  if (!clockIn || !clockOut) return '—';
  const diff = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hrs}h ${mins}m`;
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

// ── Simple calendar date picker ──────────────────────────
function CalendarPicker({
  visible,
  title,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  selected: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const initDate = selected ? new Date(selected + 'T00:00:00') : today;
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());
  const [picked, setPicked] = useState<string>(selected);

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric',
  });

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  // Build grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const blanks = firstDay; // Sun-based offset
  const cells: (number | null)[] = [
    ...Array(blanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={cal.backdrop}>
        <View style={cal.box}>
          <ThemedText variant="body" color="muted" style={cal.title}>{title}</ThemedText>

          <View style={cal.navRow}>
            <TouchableOpacity onPress={prevMonth}><ThemedText variant="body" color="accent">‹</ThemedText></TouchableOpacity>
            <ThemedText variant="body" color="primary">{monthLabel}</ThemedText>
            <TouchableOpacity onPress={nextMonth}><ThemedText variant="body" color="accent">›</ThemedText></TouchableOpacity>
          </View>

          <View style={cal.grid}>
            {DAYS.map((d) => (
              <Text key={d} style={cal.dayHeader}>{d}</Text>
            ))}
            {cells.map((day, idx) => {
              if (!day) return <View key={`b${idx}`} style={cal.cell} />;
              const ds = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isPicked = ds === picked;
              return (
                <TouchableOpacity
                  key={ds}
                  style={[cal.cell, isPicked && cal.cellPicked]}
                  onPress={() => setPicked(ds)}
                >
                  <Text style={[cal.dayText, isPicked && cal.dayTextPicked]}>{day}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={cal.footer}>
            <TouchableOpacity onPress={onClose}>
              <ThemedText variant="body" color="muted">Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { onSelect(picked); onClose(); }}>
              <ThemedText variant="body" color="mint">Confirm</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ──────────────────────────────────────────
export function StaffAttendanceScreen() {
  const navigation = useNavigation<any>();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [pickerFor, setPickerFor] = useState<'start' | 'end' | null>(null);

  const { data: todayRecord, isLoading: todayLoading } = useTodayAttendance();
  const { data: history } = useAttendanceHistory(month, year);
  const { data: leaves } = useStaffLeaves();
  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const requestLeave = useRequestLeave();

  const isClockedIn = !!todayRecord?.clock_in_time && !todayRecord?.clock_out_time;
  const isClockedOut = !!todayRecord?.clock_out_time;

  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric',
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
      Alert.alert('Error', 'Please select start and end dates');
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
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const leaveStatusColor = (status: string) =>
    status === 'Approved' ? Theme.colors.status.success
    : status === 'Rejected' ? Theme.colors.status.error
    : Theme.colors.status.warning;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Header row: back + centred title */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary" style={styles.title}>
            My Attendance / My Leaves
          </ThemedText>
          <View style={styles.backBtn} />
        </View>

        <View style={styles.hairline} />

        {/* Today */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>TODAY</ThemedText>

          <View style={styles.clockRow}>
            <View style={styles.clockItem}>
              <ThemedText variant="small" color="subtitle">Clock In</ThemedText>
              <ThemedText variant="subtitle" color="primary">{formatTime(todayRecord?.clock_in_time ?? null)}</ThemedText>
            </View>
            <View style={styles.clockItem}>
              <ThemedText variant="small" color="subtitle">Clock Out</ThemedText>
              <ThemedText variant="subtitle" color="primary">{formatTime(todayRecord?.clock_out_time ?? null)}</ThemedText>
            </View>
            <View style={styles.clockItem}>
              <ThemedText variant="small" color="subtitle">Hours</ThemedText>
              <ThemedText variant="subtitle" color="primary">
                {getHoursWorked(todayRecord?.clock_in_time ?? null, todayRecord?.clock_out_time ?? null)}
              </ThemedText>
            </View>
          </View>

          <View style={styles.clockActions}>
            {!todayRecord?.clock_in_time && (
              <TouchableOpacity onPress={handleClockIn} disabled={clockIn.isPending || todayLoading}>
                <ThemedText variant="body" color="mint">Clock In  ›</ThemedText>
              </TouchableOpacity>
            )}
            {isClockedIn && (
              <TouchableOpacity onPress={handleClockOut} disabled={clockOut.isPending}>
                <ThemedText variant="body" color="mint">Clock Out  ›</ThemedText>
              </TouchableOpacity>
            )}
            {isClockedOut && (
              <ThemedText variant="small" color="mint">Shift complete ✓</ThemedText>
            )}
          </View>
        </View>

        <View style={styles.hairline} />

        {/* Monthly history */}
        <View style={styles.section}>
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={prevMonth}>
              <ThemedText variant="body" color="accent">‹</ThemedText>
            </TouchableOpacity>
            <ThemedText variant="body" color="primary">{monthLabel}</ThemedText>
            <TouchableOpacity onPress={nextMonth}>
              <ThemedText variant="body" color="accent">›</ThemedText>
            </TouchableOpacity>
          </View>
          <ThemedText variant="small" color="muted" style={{ marginBottom: Theme.spacing.sm }}>
            Present: {daysPresent} / {history?.length ?? 0} days
          </ThemedText>

          {(history ?? []).length === 0 ? (
            <ThemedText variant="body" color="muted">No records this month</ThemedText>
          ) : (
            (history ?? []).map((record) => (
              <View key={record.id} style={styles.historyRow}>
                <ThemedText variant="body" color="primary" style={{ minWidth: 96 }}>{record.date}</ThemedText>
                <ThemedText variant="body" color="subtitle">
                  {formatTime(record.clock_in_time)} — {formatTime(record.clock_out_time)}
                </ThemedText>
                <ThemedText variant="small" color="muted">
                  {getHoursWorked(record.clock_in_time, record.clock_out_time)}
                </ThemedText>
              </View>
            ))
          )}
        </View>

        <View style={styles.hairline} />

        {/* Leave requests */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>MY LEAVES</ThemedText>
            <TouchableOpacity onPress={() => setShowLeaveForm(!showLeaveForm)}>
              <ThemedText variant="body" color={showLeaveForm ? 'muted' : 'mint'}>
                {showLeaveForm ? 'Cancel' : '+ Apply Leave'}
              </ThemedText>
            </TouchableOpacity>
          </View>

          {showLeaveForm && (
            <View style={styles.leaveForm}>
              {/* Start date */}
              <TouchableOpacity style={styles.dateRow} onPress={() => setPickerFor('start')}>
                <ThemedText variant="body" color="subtitle">From</ThemedText>
                <ThemedText variant="body" color={leaveStart ? 'primary' : 'muted'}>
                  {leaveStart || 'Select date'}
                </ThemedText>
              </TouchableOpacity>
              <View style={styles.hairlineThin} />

              {/* End date */}
              <TouchableOpacity style={styles.dateRow} onPress={() => setPickerFor('end')}>
                <ThemedText variant="body" color="subtitle">To</ThemedText>
                <ThemedText variant="body" color={leaveEnd ? 'primary' : 'muted'}>
                  {leaveEnd || 'Select date'}
                </ThemedText>
              </TouchableOpacity>
              <View style={styles.hairlineThin} />

              {/* Reason */}
              <TextInput
                style={styles.reasonInput}
                placeholder="Reason (optional)"
                placeholderTextColor={Theme.colors.text.muted}
                value={leaveReason}
                onChangeText={setLeaveReason}
                multiline
              />
              <View style={styles.hairlineThin} />

              <TouchableOpacity
                style={styles.submitRow}
                onPress={handleLeaveSubmit}
                disabled={requestLeave.isPending}
              >
                <ThemedText variant="body" color="mint">Submit Request  ›</ThemedText>
              </TouchableOpacity>
            </View>
          )}

          {(leaves ?? []).length === 0 && !showLeaveForm ? (
            <ThemedText variant="body" color="muted">No leave requests</ThemedText>
          ) : (
            (leaves ?? []).map((leave) => (
              <View key={leave.id} style={styles.leaveRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText variant="body" color="primary">
                    {leave.start_date} → {leave.end_date}
                  </ThemedText>
                  {leave.reason && (
                    <ThemedText variant="small" color="muted">{leave.reason}</ThemedText>
                  )}
                </View>
                <ThemedText variant="small" color="primary" style={{ color: leaveStatusColor(leave.status) }}>
                  {leave.status}
                </ThemedText>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Date pickers */}
      <CalendarPicker
        visible={pickerFor === 'start'}
        title="Select start date"
        selected={leaveStart}
        onSelect={setLeaveStart}
        onClose={() => setPickerFor(null)}
      />
      <CalendarPicker
        visible={pickerFor === 'end'}
        title="Select end date"
        selected={leaveEnd}
        onSelect={setLeaveEnd}
        onClose={() => setPickerFor(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { paddingBottom: Theme.spacing.xl },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  backBtn: { minWidth: 60 },
  title: { flex: 1, textAlign: 'center', paddingVertical: Theme.spacing.sm },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: Theme.colors.text.mint },
  hairlineThin: { height: StyleSheet.hairlineWidth, backgroundColor: Theme.colors.layout.divider },
  section: { paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm },
  sectionLabel: { letterSpacing: 1, marginBottom: Theme.spacing.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clockRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: Theme.spacing.sm },
  clockItem: { alignItems: 'center' },
  clockActions: { alignItems: 'flex-start', marginTop: Theme.spacing.xs },
  monthNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Theme.spacing.sm },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  leaveForm: { marginTop: Theme.spacing.sm },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.sm + 2,
  },
  reasonInput: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    color: Theme.colors.text.primary,
    paddingVertical: Theme.spacing.sm,
    minHeight: 60,
  },
  submitRow: { alignItems: 'flex-end', paddingVertical: Theme.spacing.sm },
  leaveRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
});

const cal = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  box: {
    backgroundColor: Theme.colors.background.secondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },
  title: { textAlign: 'center', marginBottom: Theme.spacing.sm, letterSpacing: 1 },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayHeader: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: Theme.colors.text.muted,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small,
    paddingVertical: 4,
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellPicked: {
    backgroundColor: Theme.colors.text.mint,
    borderRadius: 20,
  },
  dayText: {
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
  },
  dayTextPicked: { color: Theme.colors.background.primary },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
});
