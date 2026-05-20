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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { CalendarPicker } from '../../components/CalendarPicker';
import {
  useTodayAttendance,
  useAttendanceHistory,
  useClockIn,
  useClockOut,
  useStaffLeaves,
  useRequestLeave,
} from '../../hooks/useAttendance';
import { todayIST, addDaysToISODate } from '../../utils/istDate';
import { useMyAttendanceCorrections } from '../../hooks/useAttendanceCorrections';
import { CorrectionRequestModal } from './components/CorrectionRequestModal';

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

// ── Month calendar (P / L / A) — same shape as admin AttendanceTab ──

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

interface AttendanceRow { id: number; date: string; clock_in_time: string | null }
interface LeaveRow { id: number; start_date: string; end_date: string; status: string }

function MonthCalendar({
  year,
  month,
  attendance,
  leaves,
}: {
  year: number;
  month: number;
  attendance: AttendanceRow[];
  leaves: LeaveRow[];
}) {
  const attendanceMap = useMemo(() => {
    const m = new Map<string, AttendanceRow>();
    attendance.forEach((r) => m.set(r.date, r));
    return m;
  }, [attendance]);

  const approvedLeaveSet = useMemo(() => {
    const s = new Set<string>();
    leaves.filter((l) => l.status === 'Approved').forEach((l) => {
      for (let ds = l.start_date; ds <= l.end_date; ds = addDaysToISODate(ds, 1)) s.add(ds);
    });
    return s;
  }, [leaves]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const todayStr = todayIST();

  const presentCount = attendance.filter((r) => r.clock_in_time).length;
  const leaveCount = [...Array(daysInMonth)].filter((_, i) => {
    const d = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    return approvedLeaveSet.has(d);
  }).length;
  const absentCount = [...Array(daysInMonth)].filter((_, i) => {
    const d = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    return d <= todayStr && !attendanceMap.has(d) && !approvedLeaveSet.has(d);
  }).length;

  return (
    <>
      <View style={cal.summary}>
        {[
          { lbl: 'Present', val: presentCount, color: Theme.colors.status.success },
          { lbl: 'Leave',   val: leaveCount,   color: Theme.colors.status.warning },
          { lbl: 'Absent',  val: absentCount,  color: Theme.colors.status.error   },
        ].map((s) => (
          <View key={s.lbl} style={cal.summaryItem}>
            <ThemedText variant="body" color="primary" style={[cal.summaryNum, { color: s.color }]}>{s.val}</ThemedText>
            <ThemedText variant="small" color="muted" style={cal.summaryLbl}>{s.lbl}</ThemedText>
          </View>
        ))}
      </View>

      <View style={cal.grid}>
        {DAY_LABELS.map((d) => (
          <ThemedText key={d} variant="small" color="muted" style={cal.dayHeader}>{d}</ThemedText>
        ))}
      </View>

      <View style={cal.grid}>
        {cells.map((day, idx) => {
          if (!day) return <View key={`pad-${idx}`} style={cal.cell} />;
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isPresent = attendanceMap.has(dateStr);
          const isLeave = approvedLeaveSet.has(dateStr);
          const isToday = dateStr === todayStr;
          const isFuture = dateStr > todayStr;

          let bg = 'transparent';
          let label = '';
          let labelColor: string = Theme.colors.text.muted;
          if (isPresent) { bg = Theme.colors.status.success + '30'; label = 'P'; labelColor = Theme.colors.status.success; }
          else if (isLeave) { bg = Theme.colors.status.warning + '30'; label = 'L'; labelColor = Theme.colors.status.warning; }
          else if (!isFuture) { bg = Theme.colors.status.error + '18'; label = 'A'; labelColor = Theme.colors.status.error; }

          return (
            <View key={dateStr} style={[cal.cell, { backgroundColor: bg }, isToday && cal.cellToday]}>
              <ThemedText variant="small" color="muted" style={[cal.cellDay, isToday && { color: Theme.colors.text.mint }]}>{day}</ThemedText>
              {!!label && (
                <ThemedText variant="small" color="muted" style={[cal.cellLabel, { color: labelColor }]}>{label}</ThemedText>
              )}
            </View>
          );
        })}
      </View>
    </>
  );
}

const cal = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    paddingBottom: Theme.spacing.sm,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryNum: { fontSize: Theme.typography.sizes.body + 4 },
  summaryLbl: { fontSize: Theme.typography.sizes.small + 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayHeader: { width: '14.28%', textAlign: 'center', fontSize: Theme.typography.sizes.small + 1, paddingVertical: 2 },
  cell: { width: '14.28%', aspectRatio: 1.4, alignItems: 'center', justifyContent: 'center', borderRadius: 3, padding: 1 },
  cellToday: { borderWidth: 1, borderColor: Theme.colors.text.mint },
  cellDay: { fontSize: Theme.typography.sizes.small },
  cellLabel: { fontSize: Theme.typography.sizes.small - 1 },
});

// ── Main Screen ──────────────────────────────────────────
export function StaffAttendanceScreen() {
  const navigation = useNavigation<any>();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const { data: corrections } = useMyAttendanceCorrections();
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

  const handleClockIn = () => {
    Alert.alert('Clock In', 'Your GPS location will be recorded. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clock In',
        onPress: () => clockIn.mutate(undefined, {
          onError: (e: Error) => Alert.alert('Clock In Failed', e.message),
        }),
      },
    ]);
  };

  const handleClockOut = () => {
    Alert.alert('Clock Out', 'Confirm clock out for today?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clock Out',
        onPress: () => clockOut.mutate(undefined, {
          onError: (e: Error) => Alert.alert('Clock Out Failed', e.message),
        }),
      },
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

  // Case-insensitive — leave rows use 'Approved' / 'Pending' / 'Rejected'
  // (Title-Case), correction rows use 'approved' / 'pending' / 'rejected'
  // (lowercase per the DB CHECK constraint). The status pill colour stays
  // green / yellow / red across both.
  const leaveStatusColor = (status: string) => {
    const s = (status ?? '').toLowerCase();
    if (s === 'approved') return Theme.colors.status.success;
    if (s === 'rejected') return Theme.colors.status.error;
    return Theme.colors.status.warning;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Header row: back + centred title */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary" style={styles.title}>
            Attendance / Leaves
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

        {/* Monthly attendance — calendar grid (P / L / A) to keep the
            screen compact. Same shape as the admin AttendanceTab. */}
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

          <MonthCalendar
            year={year}
            month={month}
            attendance={history ?? []}
            leaves={leaves ?? []}
          />
        </View>

        <View style={styles.hairline} />

        {/* History — merged leaves + attendance corrections */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.historyLabel}>HISTORY</ThemedText>

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

          {(leaves ?? []).length === 0 && (corrections ?? []).length === 0 && !showLeaveForm ? (
            <ThemedText variant="small" color="muted">No leave or correction requests</ThemedText>
          ) : (
            <>
              {(leaves ?? []).map((leave) => (
                <View key={`l-${leave.id}`} style={styles.leaveRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="small" color="primary">
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
              ))}

              {(corrections ?? []).map((c) => {
                const dayCount = c.days?.length ?? 0;
                return (
                  <View key={`c-${c.id}`} style={styles.leaveRow}>
                    <View style={{ flex: 1 }}>
                      <ThemedText variant="small" color="primary">
                        Correction · {dayCount} day{dayCount === 1 ? '' : 's'}
                        {c.days?.length
                          ? `  ·  ${c.days[0].the_date}${c.days.length > 1 ? ` +${c.days.length - 1}` : ''}`
                          : ''}
                      </ThemedText>
                      {c.reason && (
                        <ThemedText variant="small" color="muted">{c.reason}</ThemedText>
                      )}
                      {c.reviewer_note && c.status === 'rejected' && (
                        <ThemedText variant="small" color="accent">{c.reviewer_note}</ThemedText>
                      )}
                    </View>
                    <ThemedText variant="small" color="primary" style={{ color: leaveStatusColor(c.status) }}>
                      {c.status}
                    </ThemedText>
                  </View>
                );
              })}
            </>
          )}
        </View>

      </ScrollView>

      {/* Pinned footer — Apply Leave on the left, Attendance request on
          the right. Both stay visible no matter how far the staff has
          scrolled; the history list above stays unified. */}
      <View style={styles.footerRow}>
        <TouchableOpacity onPress={() => setShowLeaveForm(!showLeaveForm)}>
          <ThemedText variant="body" color={showLeaveForm ? 'muted' : 'mint'}>
            {showLeaveForm ? 'Cancel' : '+ Apply leave'}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowCorrectionModal(true)}>
          <ThemedText variant="body" color="mint">+ Attendance request</ThemedText>
        </TouchableOpacity>
      </View>

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

      <CorrectionRequestModal
        visible={showCorrectionModal}
        onClose={() => setShowCorrectionModal(false)}
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
  historyLabel: {
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: Theme.spacing.sm,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clockRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: Theme.spacing.sm },
  clockItem: { alignItems: 'center' },
  clockActions: { alignItems: 'flex-start', marginTop: Theme.spacing.xs },
  monthNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Theme.spacing.sm },
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

