/**
 * 1stOne F1 — Resource Manager (Admin)
 *
 * Roster view of all staff with today's attendance status.
 * Filter: All | Present | Absent | On Leave
 * Header stat bar: total, present, on leave counts.
 * Tap any row → EmployeeDetail.
 * "+" → OnboardEmployee.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { useStaffRoster, usePendingLeaves, type RosterEntry } from '../../hooks/useResourceManager';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type Filter = 'all' | 'present' | 'absent' | 'leave';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'present', label: 'Present' },
  { key: 'absent',  label: 'Absent' },
  { key: 'leave',   label: 'On Leave' },
];

const STATUS_COLOR: Record<RosterEntry['todayStatus'], string> = {
  present: Theme.colors.status.success,
  absent:  Theme.colors.status.error,
  leave:   Theme.colors.status.warning,
};

const STATUS_LABEL: Record<RosterEntry['todayStatus'], string> = {
  present: 'Present',
  absent:  'Absent',
  leave:   'On Leave',
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// ── Employee row ─────────────────────────────────────────────
function EmployeeRow({
  item,
  onPress,
}: {
  item: RosterEntry;
  onPress: () => void;
}) {
  const clockIn = formatTime(item.clockIn);
  return (
    <TouchableOpacity style={er.container} onPress={onPress} activeOpacity={0.7}>
      <View style={er.left}>
        {/* Name + designation */}
        <ThemedText variant="body" color="primary" style={er.name}>
          {item.full_name || item.phone_number}
        </ThemedText>
        <ThemedText variant="small" color="muted" style={er.meta}>
          {[item.employee_id, item.designation].filter(Boolean).join('  ·  ') || item.phone_number}
        </ThemedText>
        {item.shift_timing ? (
          <ThemedText variant="small" color="muted" style={er.shift}>
            {item.shift_timing.split('  ')[0]}
          </ThemedText>
        ) : null}
      </View>
      <View style={er.right}>
        <View style={[er.badge, { backgroundColor: STATUS_COLOR[item.todayStatus] + '22' }]}>
          <ThemedText
            variant="small"
            color="primary"
            style={[er.badgeTxt, { color: STATUS_COLOR[item.todayStatus] }]}
          >
            {STATUS_LABEL[item.todayStatus]}
          </ThemedText>
        </View>
        {item.todayStatus === 'present' && !!clockIn && (
          <ThemedText variant="small" color="muted" style={er.clockIn}>
            In {clockIn}
          </ThemedText>
        )}
        <ThemedText variant="small" color="muted" style={er.chevron}>›</ThemedText>
      </View>
    </TouchableOpacity>
  );
}

const er = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  left:  { flex: 1, marginRight: Theme.spacing.sm },
  name:  { fontSize: B, marginBottom: 2 },
  meta:  { fontSize: S },
  shift: { fontSize: S, marginTop: 2, opacity: 0.7 },
  right: { alignItems: 'flex-end', gap: 4 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeTxt: { fontSize: S, fontWeight: '600' },
  clockIn:  { fontSize: S },
  chevron:  { fontSize: B + 4, opacity: 0.4 },
});

function formatDate(str: string): string {
  return new Date(str).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function leaveDays(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
}

// ── Pending leave row ─────────────────────────────────────────
function PendingLeaveRow({ item, onReview }: { item: any; onReview: (id: number, status: 'Approved' | 'Rejected') => void }) {
  const name = item.profiles?.full_name || item.profiles?.phone_number || 'Staff';
  const empId = item.profiles?.employee_id ? `  ·  ${item.profiles.employee_id}` : '';
  const days = leaveDays(item.start_date, item.end_date);
  return (
    <View style={pl.row}>
      <View style={pl.left}>
        <ThemedText variant="body" color="primary" style={{ fontSize: B }}>{name}{empId}</ThemedText>
        <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
          {formatDate(item.start_date)}{item.start_date !== item.end_date ? ` – ${formatDate(item.end_date)}` : ''}  ·  {days} day{days !== 1 ? 's' : ''}
          {item.reason ? `  ·  ${item.reason}` : ''}
        </ThemedText>
      </View>
      <View style={pl.btns}>
        <TouchableOpacity style={pl.approveBtn} onPress={() => onReview(item.id, 'Approved')} activeOpacity={0.7}>
          <ThemedText variant="small" color="primary" style={{ fontSize: S }}>Approve</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={pl.rejectBtn} onPress={() => onReview(item.id, 'Rejected')} activeOpacity={0.7}>
          <ThemedText variant="small" color="primary" style={{ fontSize: S }}>Reject</ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const pl = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  left:       { flex: 1, marginRight: Theme.spacing.sm },
  btns:       { flexDirection: 'row', gap: 8 },
  approveBtn: {
    backgroundColor: Theme.colors.status.success,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
  },
  rejectBtn: {
    backgroundColor: Theme.colors.status.error,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
  },
});

// ── Main screen ───────────────────────────────────────────────
export function ResourceManagerScreen({ navigation }: { navigation: any }) {
  const [filter, setFilter] = useState<Filter>('all');
  const { data: roster = [], isLoading, refetch } = useStaffRoster();
  const { data: pendingLeaves = [], review: reviewLeave } = usePendingLeaves();

  const filtered = useMemo(() => {
    if (filter === 'all') return roster;
    return roster.filter((e) => e.todayStatus === filter);
  }, [roster, filter]);

  const presentCount = roster.filter((e) => e.todayStatus === 'present').length;
  const leaveCount   = roster.filter((e) => e.todayStatus === 'leave').length;

  const handleReview = (leaveId: number, status: 'Approved' | 'Rejected') => {
    Alert.alert(status, `${status === 'Approved' ? 'Approve' : 'Reject'} this leave request?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: status,
        style: status === 'Rejected' ? 'destructive' : 'default',
        onPress: () => reviewLeave.mutate(
          { leaveId, status },
          { onError: (e: any) => Alert.alert('Error', e?.message) }
        ),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Resource Manager
        </ThemedText>
        <TouchableOpacity onPress={() => navigation.navigate('OnboardEmployee')}>
          <ThemedText variant="body" color="mint" style={styles.add}>+ Add</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Today stats */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <ThemedText variant="body" color="primary" style={styles.statNum}>{roster.length}</ThemedText>
          <ThemedText variant="small" color="muted" style={styles.statLbl}>Total</ThemedText>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <ThemedText variant="body" color="mint" style={styles.statNum}>{presentCount}</ThemedText>
          <ThemedText variant="small" color="muted" style={styles.statLbl}>Present</ThemedText>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <ThemedText variant="body" color="primary" style={[styles.statNum, { color: Theme.colors.status.warning }]}>
            {leaveCount}
          </ThemedText>
          <ThemedText variant="small" color="muted" style={styles.statLbl}>On Leave</ThemedText>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <ThemedText variant="body" color="primary" style={[styles.statNum, { color: Theme.colors.status.error }]}>
            {roster.length - presentCount - leaveCount}
          </ThemedText>
          <ThemedText variant="small" color="muted" style={styles.statLbl}>Absent</ThemedText>
        </View>
      </View>

      <Divider />

      {/* Pending leave approvals */}
      {pendingLeaves.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
              LEAVE REQUESTS
            </ThemedText>
            <View style={styles.pendingBadge}>
              <ThemedText variant="small" color="primary" style={{ fontSize: S, color: Theme.colors.status.warning }}>
                {pendingLeaves.length} pending
              </ThemedText>
            </View>
          </View>
          {pendingLeaves.map((l) => (
            <PendingLeaveRow key={l.id} item={l} onReview={handleReview} />
          ))}
          <Divider />
        </>
      )}

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {FILTERS.map((f, i) => (
          <React.Fragment key={f.key}>
            {i > 0 && <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>}
            <TouchableOpacity onPress={() => setFilter(f.key)}>
              <ThemedText
                variant="body"
                color={filter === f.key ? 'primary' : 'muted'}
                style={[styles.filterTxt, filter === f.key && styles.filterActive]}
              >
                {f.label}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      <Divider />

      {/* Roster list */}
      {isLoading ? (
        <ActivityIndicator color={Theme.colors.text.mint} style={{ marginTop: Theme.spacing.xl }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <EmployeeRow
              item={item}
              onPress={() => navigation.navigate('EmployeeDetail', { staffId: item.id })}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              title={filter === 'all' ? 'No staff yet' : `No staff ${filter}`}
              subtitle={filter === 'all' ? 'Tap + Add to onboard your first team member' : undefined}
            />
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={false}
        />
      )}
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
  back:  { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  add:   { fontSize: B, minWidth: 60, textAlign: 'right' },

  statsBar: {
    flexDirection: 'row',
    paddingVertical: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.md,
  },
  statItem:    { flex: 1, alignItems: 'center' },
  statNum:     { fontSize: B + 4, fontWeight: '600' },
  statLbl:     { fontSize: S, marginTop: 2 },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
    marginVertical: 4,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xs,
  },
  sectionLabel:  { fontSize: S, letterSpacing: 1, flex: 1 },
  pendingBadge:  {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: Theme.colors.status.warning + '22',
  },

  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  pipe:         { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  filterTxt:    { fontSize: B },
  filterActive: { fontWeight: '600' },

  list: { paddingBottom: Theme.spacing.xl },
});
