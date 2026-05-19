/**
 * 1stOne F1 — EmployeeDetail · Attendance tab
 *
 * Month calendar (P / A / L) with a Present/Leave/Absent summary and a
 * clock-in/out log. Extracted from EmployeeDetailScreen (audit D22).
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { Divider } from '../../../components/Divider';
import { useEmployeeMonthAttendance } from '../../../hooks/useResourceManager';
import { todayIST, addDaysToISODate } from '../../../utils/istDate';
import type { StaffAttendance, StaffLeave } from '../../../types';
import { formatDate, formatTime, tab, MONTH_NAMES } from './employeeShared';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function AttendanceTab({
  staffId,
  leaves,
}: {
  staffId: string;
  leaves: StaffLeave[];
}) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-based

  const { data: records = [], isLoading } = useEmployeeMonthAttendance(staffId, year, month);

  const attendanceMap = useMemo(() => {
    const m = new Map<string, StaffAttendance>();
    records.forEach((r) => m.set(r.date, r));
    return m;
  }, [records]);

  const approvedLeaveSet = useMemo(() => {
    const s = new Set<string>();
    leaves
      .filter((l) => l.status === 'Approved')
      .forEach((l) => {
        // Enumerate YYYY-MM-DD strings inclusively — string-safe, no toISOString.
        for (let ds = l.start_date; ds <= l.end_date; ds = addDaysToISODate(ds, 1)) {
          s.add(ds);
        }
      });
    return s;
  }, [leaves]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Mon=0

  // Pad to grid
  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const todayStr = todayIST();

  const changeMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1;  y++; }
    if (m < 1)  { m = 12; y--; }
    setMonth(m);
    setYear(y);
  };

  const presentCount = records.length;
  const leaveCount   = [...Array(daysInMonth)].filter((_, i) => {
    const d = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    return approvedLeaveSet.has(d);
  }).length;
  // Absent = elapsed days only — a day that hasn't happened yet (this month
  // or a future month) isn't an absence. Mirrors the 'A' cells in the grid
  // below, which already exclude future days.
  const absentCount  = [...Array(daysInMonth)].filter((_, i) => {
    const d = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    return d <= todayStr && !attendanceMap.has(d) && !approvedLeaveSet.has(d);
  }).length;

  return (
    <ScrollView contentContainerStyle={tab.scroll} showsVerticalScrollIndicator={false}>
      {/* Month navigator */}
      <View style={att.monthNav}>
        <TouchableOpacity onPress={() => changeMonth(-1)}>
          <ThemedText variant="body" color="accent" style={att.navBtn}>‹</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="body" color="primary" style={att.monthLabel}>
          {MONTH_NAMES[month - 1]} {year}
        </ThemedText>
        <TouchableOpacity onPress={() => changeMonth(1)}>
          <ThemedText variant="body" color="accent" style={att.navBtn}>›</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Summary row */}
      <View style={att.summary}>
        {[
          { label: 'Present', val: presentCount, color: Theme.colors.status.success },
          { label: 'Leave',   val: leaveCount,   color: Theme.colors.status.warning },
          { label: 'Absent',  val: absentCount,  color: Theme.colors.status.error   },
        ].map((s) => (
          <View key={s.label} style={att.summaryItem}>
            <ThemedText variant="body" color="primary" style={[att.summaryNum, { color: s.color }]}>
              {s.val}
            </ThemedText>
            <ThemedText variant="small" color="muted" style={att.summaryLbl}>{s.label}</ThemedText>
          </View>
        ))}
      </View>

      <Divider />

      {/* Day-of-week headers */}
      <View style={att.calGrid}>
        {DAY_LABELS.map((d) => (
          <ThemedText key={d} variant="small" color="muted" style={att.dayHeader}>{d}</ThemedText>
        ))}
      </View>

      {/* Calendar cells */}
      {isLoading ? (
        <ActivityIndicator color={Theme.colors.text.mint} style={{ marginTop: Theme.spacing.md }} />
      ) : (
        <View style={att.calGrid}>
          {cells.map((day, idx) => {
            if (!day) return <View key={`pad-${idx}`} style={att.cell} />;
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isPresent = attendanceMap.has(dateStr);
            const isLeave   = approvedLeaveSet.has(dateStr);
            const isToday   = dateStr === todayStr;
            const isFuture  = dateStr > todayStr;

            let bg = 'transparent';
            let label = '';
            let labelColor: string = Theme.colors.text.muted;

            if (isPresent) {
              bg = Theme.colors.status.success + '30';
              label = 'P';
              labelColor = Theme.colors.status.success;
            } else if (isLeave) {
              bg = Theme.colors.status.warning + '30';
              label = 'L';
              labelColor = Theme.colors.status.warning;
            } else if (!isFuture) {
              bg = Theme.colors.status.error + '18';
              label = 'A';
              labelColor = Theme.colors.status.error;
            }

            return (
              <View
                key={dateStr}
                style={[
                  att.cell,
                  { backgroundColor: bg },
                  isToday && att.cellToday,
                ]}
              >
                <ThemedText
                  variant="small"
                  color="muted"
                  style={[att.cellDay, isToday && { color: Theme.colors.text.mint }]}
                >
                  {day}
                </ThemedText>
                {!!label && (
                  <ThemedText
                    variant="small"
                    color="muted"
                    style={[att.cellLabel, { color: labelColor }]}
                  >
                    {label}
                  </ThemedText>
                )}
              </View>
            );
          })}
        </View>
      )}

      <Divider />

      {/* Clock-in list */}
      <ThemedText variant="small" color="muted" style={tab.sectionLabel}>CLOCK-IN LOG</ThemedText>
      {records.length === 0 ? (
        <ThemedText variant="body" color="muted" style={tab.empty}>No records this month</ThemedText>
      ) : (
        [...records].reverse().map((r) => (
          <View key={r.id} style={att.logRow}>
            <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
              {formatDate(r.date)}
            </ThemedText>
            <View style={att.logTimes}>
              <ThemedText variant="small" color="muted" style={{ fontSize: S }}>
                In  {formatTime(r.clock_in_time)}
              </ThemedText>
              <ThemedText variant="small" color="muted" style={{ fontSize: S }}>
                Out  {formatTime(r.clock_out_time)}
              </ThemedText>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const att = StyleSheet.create({
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  navBtn:      { fontSize: B + 8, paddingHorizontal: Theme.spacing.sm },
  monthLabel:  { fontSize: B + 2 },
  summary: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryNum:  { fontSize: B + 4 },
  summaryLbl:  { fontSize: S },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Theme.spacing.sm,
  },
  dayHeader: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: S,
    paddingVertical: 4,
  },
  cell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    padding: 2,
  },
  cellToday: {
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
  },
  cellDay:   { fontSize: S - 1 },
  cellLabel: { fontSize: S - 2 },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  logTimes: { alignItems: 'flex-end', gap: 2 },
});
