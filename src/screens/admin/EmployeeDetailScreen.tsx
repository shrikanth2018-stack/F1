/**
 * 1stOne F1 — Employee Detail Screen (Admin)
 *
 * 4 tabs for a single staff member:
 *   Profile    — view / inline-edit basic info
 *   Attendance — month calendar (P / A / L) + clock-in/out list
 *   Leave      — pending approvals + history
 *   Salary     — monthly salary cards + mark paid + add record
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { CompactField } from '../../components/CompactField';
import { CompactFieldWithSuggestions } from '../../components/CompactFieldWithSuggestions';
import { CompactTimeRangeField } from '../../components/CompactTimeRangeField';
import { SectionRow } from '../../components/SectionRow';
import { MultiChipPicker } from '../../components/MultiChipPicker';
import {
  useUpdateEmployee,
  useEmployeeMonthAttendance,
  useEmployeeLeaves,
  useEmployeeSalary,
  useStaffLookups,
  useDemoteEmployee,
} from '../../hooks/useResourceManager';
import { useBranchFilter } from '../../hooks/useBranchFilter';
import { useBranches } from '../../hooks/useBranches';
import { useAllStaff } from '../../hooks/useStaffManagement';
import type { Profile, StaffAttendance, StaffLeave } from '../../types';
import type { AdminScreenProps, AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type DetailTab = 'Profile' | 'Attendance' | 'Leave' | 'Salary';
const DETAIL_TABS: DetailTab[] = ['Profile', 'Attendance', 'Leave', 'Salary'];

const MONTH_NAMES = [
  'Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec',
];

// ── Helpers ───────────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatDate(str: string | null): string {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ── Tab: Profile ─────────────────────────────────────────────
function ProfileTab({ staff, navigation }: { staff: Profile; navigation: AdminNavProp }) {
  const update = useUpdateEmployee();
  const { data: lookups } = useStaffLookups();
  const branchFilter = useBranchFilter();
  const { data: branches = [] } = useBranches();
  const demote = useDemoteEmployee();
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  // FT-03: ADMIN HEAD chip is super-admin only (server enforces; cosmetic here).
  const designations = (lookups?.designations ?? []).filter(
    (d) => branchFilter.isSuperAdmin || d !== 'ADMIN HEAD'
  );
  const benefitOptions = lookups?.benefits ?? [];
  const isEditing = mode === 'edit';

  const branchName =
    staff.branch_id != null
      ? branches.find((b) => b.id === staff.branch_id)?.branch_name ?? `Branch ${staff.branch_id}`
      : '—';

  const benefitsList = staff.benefits
    ? staff.benefits.split(',').map((b) => b.trim()).filter(Boolean)
    : [];

  const save = (field: Parameters<typeof update.mutate>[0]['updates']) =>
    update.mutate(
      { staffId: staff.id, updates: field },
      { onError: (e: any) => Alert.alert('Error', e?.message) }
    );

  const toggleBenefit = (v: string) => {
    const next = benefitsList.includes(v)
      ? benefitsList.filter((b) => b !== v)
      : [...benefitsList, v];
    save({ benefits: next.join(',') || null });
  };

  const confirmOffboard = () => {
    Alert.alert(
      'Offboard Employee?',
      `This will revoke ${staff.full_name || 'this employee'}'s staff access and stamp today as their exit date. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Offboard',
          style: 'destructive',
          onPress: () =>
            demote.mutate(staff.id, {
              onSuccess: () => {
                Alert.alert('Offboarded', `${staff.full_name || 'Employee'} has been offboarded.`);
                navigation.goBack();
              },
              onError: (e: any) =>
                Alert.alert('Cannot Offboard', e?.message ?? 'Failed to offboard employee'),
            }),
        },
      ]
    );
  };

  return (
    <ScrollView
      contentContainerStyle={tab.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Edit / Done toggle (top right) */}
      <View style={editBar.row}>
        <TouchableOpacity onPress={() => setMode(isEditing ? 'view' : 'edit')} activeOpacity={0.7}>
          <ThemedText variant="body" color="mint" style={editBar.text}>
            {isEditing ? 'Done' : 'Edit'}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Display-only attributes (always read-only) */}
      <SectionRow label="Employee ID">
        <CompactField placeholder="—" value={staff.employee_id ?? ''} editable={false} extracted />
      </SectionRow>
      <SectionRow label="Phone">
        <CompactField placeholder="" value={staff.phone_number} editable={false} />
      </SectionRow>
      <SectionRow label="Joining">
        <CompactField placeholder="—" value={formatDate(staff.joining_date)} editable={false} />
      </SectionRow>
      {branchFilter.isActive && (
        <SectionRow label="Branch">
          <CompactField placeholder="—" value={branchName} editable={false} />
        </SectionRow>
      )}

      {/* Editable attributes (gated by edit toggle) */}
      <SectionRow label="Name">
        <CompactField
          placeholder="Full Name"
          value={staff.full_name ?? ''}
          editable={isEditing}
          onCommit={isEditing ? (v) => save({ full_name: v }) : undefined}
        />
      </SectionRow>
      <SectionRow label="Role">
        <CompactFieldWithSuggestions
          placeholder="Designation"
          value={staff.designation ?? ''}
          onCommit={(v) => save({ designation: v })}
          suggestions={designations}
          editable={isEditing}
        />
      </SectionRow>
      <SectionRow label="Shift">
        <CompactTimeRangeField
          value={staff.shift_timing ?? ''}
          onChange={(v) => save({ shift_timing: v })}
          editable={isEditing}
        />
      </SectionRow>
      <SectionRow label="Salary">
        <CompactField
          placeholder="Monthly Salary (₹)"
          value={staff.monthly_salary != null ? String(staff.monthly_salary) : ''}
          editable={isEditing}
          onCommit={
            isEditing
              ? (v) => {
                  const n = parseFloat(v);
                  save({ monthly_salary: isNaN(n) ? null : n });
                }
              : undefined
          }
          keyboardType="numeric"
        />
      </SectionRow>

      {/* Benefits — view mode shows the comma-joined summary; edit mode shows
          the multi-select chip group. */}
      <Divider />
      <ThemedText variant="small" color="mint" style={tab.sectionLabel}>BENEFITS</ThemedText>
      {isEditing ? (
        <MultiChipPicker
          options={benefitOptions}
          selected={benefitsList}
          onToggle={toggleBenefit}
        />
      ) : (
        <CompactField
          placeholder="—"
          value={benefitsList.length ? benefitsList.join(', ') : ''}
          editable={false}
        />
      )}

      {/* Offboard — destructive action at the bottom of the Profile tab. */}
      <View style={ob.wrap}>
        <TouchableOpacity
          style={ob.btn}
          onPress={confirmOffboard}
          disabled={demote.isPending}
          activeOpacity={0.7}
        >
          {demote.isPending ? (
            <ActivityIndicator color={Theme.colors.status.error} />
          ) : (
            <ThemedText variant="body" style={ob.btnText}>Offboard Employee</ThemedText>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const editBar = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xs,
  },
  text: {
    fontSize: B,
    fontWeight: '600',
  },
});

// Used by the SalaryTab "Add salary record" form below — was previously
// shared with the ProfileTab's EditField helper (now compact-refactored).
const ef = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    paddingVertical: Theme.spacing.sm + 2,
  },
  label: { fontSize: S, letterSpacing: 0.5, marginBottom: 4 },
  input: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    color: Theme.colors.text.primary,
  },
});

const ob = StyleSheet.create({
  wrap: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.xl,
    paddingBottom: Theme.spacing.lg,
  },
  btn: {
    paddingVertical: Theme.spacing.sm + 2,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.status.error,
    alignItems: 'center',
  },
  btnText: {
    color: Theme.colors.status.error,
    fontSize: B,
  },
});

// ── Tab: Attendance ──────────────────────────────────────────

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function AttendanceTab({
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
        const start = new Date(l.start_date);
        const end   = new Date(l.end_date);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          s.add(d.toISOString().split('T')[0]);
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

  const todayStr = now.toISOString().split('T')[0];

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
  const absentCount  = daysInMonth - presentCount - leaveCount;

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
  monthLabel:  { fontSize: B + 2, fontWeight: '600' },
  summary: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryNum:  { fontSize: B + 4, fontWeight: '700' },
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
  cellLabel: { fontSize: S - 2, fontWeight: '700' },
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

// ── Tab: Leave ───────────────────────────────────────────────
function LeaveTab({ staffId }: { staffId: string }) {
  const { data: leaves = [], isLoading, review } = useEmployeeLeaves(staffId);

  const pending  = leaves.filter((l) => l.status === 'Pending');
  const history  = leaves.filter((l) => l.status !== 'Pending');

  const handleReview = (leaveId: number, status: 'Approved' | 'Rejected') => {
    Alert.alert(status, `${status === 'Approved' ? 'Approve' : 'Reject'} this leave request?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: status,
        style: status === 'Rejected' ? 'destructive' : 'default',
        onPress: () =>
          review.mutate(
            { leaveId, status },
            { onError: (e: any) => Alert.alert('Error', e?.message) }
          ),
      },
    ]);
  };

  if (isLoading) {
    return <ActivityIndicator color={Theme.colors.text.mint} style={{ marginTop: Theme.spacing.xl }} />;
  }

  return (
    <ScrollView contentContainerStyle={tab.scroll} showsVerticalScrollIndicator={false}>
      <ThemedText variant="small" color="muted" style={tab.sectionLabel}>
        PENDING  ({pending.length})
      </ThemedText>
      {pending.length === 0 ? (
        <ThemedText variant="body" color="muted" style={tab.empty}>No pending requests</ThemedText>
      ) : (
        pending.map((l) => (
          <View key={l.id} style={lv.card}>
            <View style={lv.top}>
              <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                {formatDate(l.start_date)} – {formatDate(l.end_date)}
              </ThemedText>
              <View style={lv.btnRow}>
                <TouchableOpacity
                  style={lv.approveBtn}
                  onPress={() => handleReview(l.id, 'Approved')}
                  disabled={review.isPending}
                >
                  <ThemedText variant="small" color="primary" style={{ fontSize: S }}>Approve</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={lv.rejectBtn}
                  onPress={() => handleReview(l.id, 'Rejected')}
                  disabled={review.isPending}
                >
                  <ThemedText variant="small" color="primary" style={{ fontSize: S }}>Reject</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
            {!!l.reason && (
              <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 4 }}>
                {l.reason}
              </ThemedText>
            )}
          </View>
        ))
      )}

      <Divider />
      <ThemedText variant="small" color="muted" style={tab.sectionLabel}>HISTORY</ThemedText>
      {history.length === 0 ? (
        <ThemedText variant="body" color="muted" style={tab.empty}>No history</ThemedText>
      ) : (
        history.map((l) => (
          <View key={l.id} style={lv.histRow}>
            <View>
              <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                {formatDate(l.start_date)} – {formatDate(l.end_date)}
              </ThemedText>
              {!!l.reason && (
                <ThemedText variant="small" color="muted" style={{ fontSize: S }}>{l.reason}</ThemedText>
              )}
            </View>
            <ThemedText
              variant="small"
              color="muted"
              style={{ fontSize: S, fontWeight: '600', color: l.status === 'Approved' ? Theme.colors.text.mint : Theme.colors.status.error }}
            >
              {l.status}
            </ThemedText>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const lv = StyleSheet.create({
  card: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  top:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  btnRow: { flexDirection: 'row', gap: 8 },
  approveBtn: {
    backgroundColor: Theme.colors.status.success,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  rejectBtn: {
    backgroundColor: Theme.colors.status.error,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  histRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
});

// ── Tab: Salary ───────────────────────────────────────────────
function SalaryTab({ staffId }: { staffId: string }) {
  const { data: records = [], isLoading, markPaid, addRecord } = useEmployeeSalary(staffId);
  const [showAdd, setShowAdd]   = useState(false);
  const [base, setBase]         = useState('');
  const [deductions, setDed]    = useState('0');
  const [bonus, setBonus]       = useState('0');
  const now = new Date();
  const [addMonth, setAddMonth] = useState(String(now.getMonth() + 1));
  const [addYear, setAddYear]   = useState(String(now.getFullYear()));

  const handleAdd = () => {
    const b = parseFloat(base);
    const d = parseFloat(deductions);
    const bn = parseFloat(bonus);
    if (isNaN(b) || b <= 0) { Alert.alert('', 'Enter a valid base salary'); return; }
    addRecord.mutate(
      {
        month: parseInt(addMonth, 10),
        year:  parseInt(addYear, 10),
        base_salary: b,
        deductions: isNaN(d) ? 0 : d,
        bonus: isNaN(bn) ? 0 : bn,
      },
      {
        onSuccess: () => { setShowAdd(false); setBase(''); setDed('0'); setBonus('0'); },
        onError:   (e: any) => Alert.alert('Error', e?.message),
      }
    );
  };

  if (isLoading) {
    return <ActivityIndicator color={Theme.colors.text.mint} style={{ marginTop: Theme.spacing.xl }} />;
  }

  return (
    <ScrollView contentContainerStyle={tab.scroll} showsVerticalScrollIndicator={false}>
      {records.length === 0 ? (
        <EmptyState title="No salary records yet" />
      ) : (
        records.map((r) => (
          <View key={r.id} style={sal.card}>
            <View style={sal.cardHeader}>
              <ThemedText variant="body" color="primary" style={{ fontSize: B, fontWeight: '600' }}>
                {MONTH_NAMES[r.month - 1]} {r.year}
              </ThemedText>
              <View style={[sal.badge, r.is_paid ? sal.paidBadge : sal.pendingBadge]}>
                <ThemedText
                  variant="small"
                  color="primary"
                  style={{ fontSize: S, color: r.is_paid ? Theme.colors.status.success : Theme.colors.status.warning }}
                >
                  {r.is_paid ? 'Paid' : 'Pending'}
                </ThemedText>
              </View>
            </View>
            <View style={sal.lineRow}>
              <ThemedText variant="small" color="muted" style={{ fontSize: S }}>Base</ThemedText>
              <ThemedText variant="small" color="primary" style={{ fontSize: S }}>₹{r.base_salary.toLocaleString('en-IN')}</ThemedText>
            </View>
            {r.deductions > 0 && (
              <View style={sal.lineRow}>
                <ThemedText variant="small" color="muted" style={{ fontSize: S }}>Deductions</ThemedText>
                <ThemedText variant="small" color="primary" style={{ fontSize: S, color: Theme.colors.status.error }}>– ₹{r.deductions.toLocaleString('en-IN')}</ThemedText>
              </View>
            )}
            {r.bonus > 0 && (
              <View style={sal.lineRow}>
                <ThemedText variant="small" color="muted" style={{ fontSize: S }}>Bonus</ThemedText>
                <ThemedText variant="small" color="mint" style={{ fontSize: S }}>+ ₹{r.bonus.toLocaleString('en-IN')}</ThemedText>
              </View>
            )}
            <View style={[sal.lineRow, sal.netRow]}>
              <ThemedText variant="body" color="primary" style={{ fontSize: B, fontWeight: '600' }}>Net</ThemedText>
              <ThemedText variant="body" color="primary" style={{ fontSize: B, fontWeight: '700' }}>₹{r.net_salary.toLocaleString('en-IN')}</ThemedText>
            </View>
            {!r.is_paid && (
              <TouchableOpacity
                onPress={() =>
                  Alert.alert('Mark Paid', `Mark ₹${r.net_salary.toLocaleString('en-IN')} as paid?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Mark Paid', onPress: () => markPaid.mutate(r.id) },
                  ])
                }
                disabled={markPaid.isPending}
                activeOpacity={0.7}
              >
                <ThemedText variant="body" color="mint" style={sal.markPaid}>
                  {markPaid.isPending ? 'Saving…' : 'Mark Paid  ›'}
                </ThemedText>
              </TouchableOpacity>
            )}
            {r.is_paid && !!r.paid_at && (
              <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 4 }}>
                Paid on {formatDate(r.paid_at)}
              </ThemedText>
            )}
          </View>
        ))
      )}

      {/* Add month record */}
      {showAdd ? (
        <View style={sal.addForm}>
          <ThemedText variant="small" color="muted" style={tab.sectionLabel}>ADD SALARY RECORD</ThemedText>
          {[
            { label: 'Month (1–12)', val: addMonth, set: setAddMonth },
            { label: 'Year',         val: addYear,  set: setAddYear  },
            { label: 'Base salary ₹', val: base,   set: setBase      },
            { label: 'Deductions ₹', val: deductions, set: setDed    },
            { label: 'Bonus ₹',      val: bonus,   set: setBonus     },
          ].map((f) => (
            <View key={f.label} style={ef.row}>
              <ThemedText variant="small" color="muted" style={ef.label}>{f.label}</ThemedText>
              <TextInput
                style={ef.input}
                value={f.val}
                onChangeText={f.set}
                keyboardType="numeric"
                returnKeyType="done"
                placeholderTextColor={Theme.colors.text.muted}
              />
            </View>
          ))}
          <View style={sal.addBtns}>
            <TouchableOpacity onPress={() => setShowAdd(false)}>
              <ThemedText variant="body" color="muted" style={{ fontSize: B }}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleAdd} disabled={addRecord.isPending} activeOpacity={0.7}>
              <ThemedText variant="body" color="mint" style={{ fontSize: B }}>
                {addRecord.isPending ? 'Saving…' : 'Save  ›'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={sal.addBtn}
          onPress={() => setShowAdd(true)}
          activeOpacity={0.7}
        >
          <ThemedText variant="body" color="accent" style={{ fontSize: B }}>+ Add Month Record</ThemedText>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const sal = StyleSheet.create({
  card: {
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 10,
    padding: Theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  paidBadge:    { backgroundColor: Theme.colors.status.success + '22' },
  pendingBadge: { backgroundColor: Theme.colors.status.warning + '22' },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  netRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
    marginTop: 4,
    paddingTop: 6,
  },
  markPaid:  { fontSize: B, marginTop: Theme.spacing.sm, textAlign: 'right' },
  addForm:   { paddingHorizontal: Theme.spacing.md },
  addBtns:   {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.md,
  },
  addBtn: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
  },
});

// ── Shared tab scroll style ───────────────────────────────────
const tab = StyleSheet.create({
  scroll: { paddingBottom: Theme.spacing.xl * 2 },
  sectionLabel: {
    fontSize: S,
    letterSpacing: 1,
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },
  empty: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    fontSize: B,
  },
});

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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <ThemedText variant="header" color="primary" style={styles.name}>
            {staff.full_name || staff.phone_number}
          </ThemedText>
          <ThemedText variant="small" color="muted" style={styles.subhead}>
            {[staff.employee_id, staff.designation].filter(Boolean).join('  ·  ')}
          </ThemedText>
        </View>
        <View style={styles.spacer} />
      </View>

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

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  back:         { fontSize: B, minWidth: 60 },
  headerCenter: { flex: 1, alignItems: 'center' },
  name:         { textAlign: 'center' },
  subhead:      { fontSize: S, marginTop: 2 },
  spacer:       { minWidth: 60 },

  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  pipe:      { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  tabTxt:    { fontSize: B },
  tabActive: { fontWeight: '600' },
});
