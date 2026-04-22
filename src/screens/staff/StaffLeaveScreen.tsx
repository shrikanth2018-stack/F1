/**
 * 1stOne F1 — Staff Leave Screen
 *
 * Staff can:
 *  - View all their leave requests with current status
 *  - Apply for a new leave (start date, end date, reason)
 *
 * Status colours:
 *  Pending  → muted
 *  Approved → mint
 *  Rejected → error red
 */

import React, { useState } from 'react';
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
import { useMyLeaves, useApplyLeave } from '../../hooks/useStaffLeave';
import type { StaffLeave } from '../../types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

const STATUS_COLOR: Record<string, string> = {
  Pending:  Theme.colors.status.warning,
  Approved: Theme.colors.text.mint,
  Rejected: Theme.colors.status.error,
};

function formatDate(str: string): string {
  return new Date(str).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function leaveDays(start: string, end: string): number {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24)) + 1;
}

// ── Apply form ────────────────────────────────────────────────
function ApplyForm({ onCancel }: { onCancel: () => void }) {
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStart] = useState(today);
  const [endDate,   setEnd]   = useState(today);
  const [reason,    setReason] = useState('');
  const apply = useApplyLeave();

  const validate = (): string | null => {
    if (!startDate.match(/^\d{4}-\d{2}-\d{2}$/)) return 'Enter start date as YYYY-MM-DD';
    if (!endDate.match(/^\d{4}-\d{2}-\d{2}$/))   return 'Enter end date as YYYY-MM-DD';
    if (startDate < today) return 'Start date cannot be in the past';
    if (endDate < startDate) return 'End date cannot be before start date';
    return null;
  };

  const handleSubmit = () => {
    const err = validate();
    if (err) { Alert.alert('', err); return; }
    apply.mutate(
      { start_date: startDate, end_date: endDate, reason: reason.trim() },
      {
        onSuccess: () => {
          Alert.alert('Submitted', 'Your leave request has been sent for approval.');
          onCancel();
        },
        onError: (e: any) => Alert.alert('Error', e?.message),
      }
    );
  };

  return (
    <View style={af.container}>
      <ThemedText variant="small" color="muted" style={af.heading}>APPLY FOR LEAVE</ThemedText>

      {[
        { label: 'Start Date  (YYYY-MM-DD)', value: startDate, set: setStart },
        { label: 'End Date  (YYYY-MM-DD)',   value: endDate,   set: setEnd   },
      ].map((f) => (
        <View key={f.label} style={af.fieldWrap}>
          <ThemedText variant="small" color="muted" style={af.fieldLabel}>{f.label}</ThemedText>
          <TextInput
            style={af.input}
            value={f.value}
            onChangeText={f.set}
            placeholder="2026-04-20"
            placeholderTextColor={Theme.colors.text.muted}
            keyboardType="numeric"
            returnKeyType="next"
          />
        </View>
      ))}

      {startDate.length === 10 && endDate.length === 10 && endDate >= startDate && (
        <ThemedText variant="small" color="muted" style={af.daysNote}>
          {leaveDays(startDate, endDate)} day{leaveDays(startDate, endDate) !== 1 ? 's' : ''}
        </ThemedText>
      )}

      <View style={af.fieldWrap}>
        <ThemedText variant="small" color="muted" style={af.fieldLabel}>Reason  (optional)</ThemedText>
        <TextInput
          style={[af.input, af.multiline]}
          value={reason}
          onChangeText={setReason}
          placeholder="Brief reason for leave"
          placeholderTextColor={Theme.colors.text.muted}
          multiline
          numberOfLines={3}
          returnKeyType="done"
        />
      </View>

      <View style={af.btns}>
        <TouchableOpacity onPress={onCancel}>
          <ThemedText variant="body" color="muted" style={{ fontSize: B }}>Cancel</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={apply.isPending}
          activeOpacity={0.7}
        >
          {apply.isPending
            ? <ActivityIndicator color={Theme.colors.text.mint} />
            : <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Submit  ›</ThemedText>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const af = StyleSheet.create({
  container: {
    marginHorizontal: Theme.spacing.md,
    marginTop: Theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.text.mint,
    borderRadius: 10,
    padding: Theme.spacing.md,
  },
  heading: {
    fontSize: S,
    letterSpacing: 1,
    marginBottom: Theme.spacing.sm,
  },
  fieldWrap:  { marginBottom: Theme.spacing.sm },
  fieldLabel: { fontSize: S, marginBottom: 4 },
  input: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    color: Theme.colors.text.primary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    paddingVertical: Theme.spacing.xs,
  },
  multiline: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 6,
    padding: Theme.spacing.sm,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  daysNote: { fontSize: S, marginBottom: Theme.spacing.sm, color: Theme.colors.text.mint },
  btns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Theme.spacing.md,
  },
});

// ── Leave row ─────────────────────────────────────────────────
function LeaveRow({ item }: { item: StaffLeave }) {
  const days = leaveDays(item.start_date, item.end_date);
  return (
    <View style={lr.container}>
      <View style={lr.left}>
        <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
          {formatDate(item.start_date)}
          {item.start_date !== item.end_date ? ` – ${formatDate(item.end_date)}` : ''}
        </ThemedText>
        <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
          {days} day{days !== 1 ? 's' : ''}
          {item.reason ? `  ·  ${item.reason}` : ''}
        </ThemedText>
      </View>
      <View style={[lr.badge, { backgroundColor: (STATUS_COLOR[item.status] ?? Theme.colors.text.muted) + '22' }]}>
        <ThemedText
          variant="small"
          color="muted"
          style={{ fontSize: S, fontWeight: '600', color: STATUS_COLOR[item.status] ?? Theme.colors.text.muted }}
        >
          {item.status}
        </ThemedText>
      </View>
    </View>
  );
}

const lr = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  left:  { flex: 1, marginRight: Theme.spacing.sm },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
});

// ── Main screen ───────────────────────────────────────────────
export function StaffLeaveScreen({ navigation }: { navigation: any }) {
  const [showForm, setShowForm] = useState(false);
  const { data: leaves = [], isLoading } = useMyLeaves();

  const pending  = leaves.filter((l) => l.status === 'Pending').length;
  const approved = leaves.filter((l) => l.status === 'Approved').length;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>My Leaves</ThemedText>
        <View style={styles.spacer} />
      </View>

      {/* Summary */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <ThemedText variant="body" color="primary" style={styles.summaryNum}>{leaves.length}</ThemedText>
          <ThemedText variant="small" color="muted" style={styles.summaryLbl}>Total</ThemedText>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <ThemedText variant="body" color="primary" style={[styles.summaryNum, { color: Theme.colors.status.warning }]}>
            {pending}
          </ThemedText>
          <ThemedText variant="small" color="muted" style={styles.summaryLbl}>Pending</ThemedText>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <ThemedText variant="body" color="mint" style={styles.summaryNum}>{approved}</ThemedText>
          <ThemedText variant="small" color="muted" style={styles.summaryLbl}>Approved</ThemedText>
        </View>
      </View>

      <Divider />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {showForm && <ApplyForm onCancel={() => setShowForm(false)} />}

        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          LEAVE HISTORY
        </ThemedText>

        {isLoading ? (
          <ActivityIndicator color={Theme.colors.text.mint} style={{ marginTop: Theme.spacing.md }} />
        ) : leaves.length === 0 ? (
          <EmptyState title="No leave requests yet" />
        ) : (
          leaves.map((l) => <LeaveRow key={l.id} item={l} />)
        )}
      </ScrollView>

      {/* Footer */}
      {!showForm && (
        <TouchableOpacity
          style={styles.footer}
          onPress={() => setShowForm(true)}
          activeOpacity={0.7}
        >
          <ThemedText variant="body" color="mint" style={{ fontSize: B }}>
            Apply for Leave  ›
          </ThemedText>
        </TouchableOpacity>
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
  back:   { fontSize: B, minWidth: 60 },
  title:  { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  summaryRow: {
    flexDirection: 'row',
    paddingVertical: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.md,
  },
  summaryItem:    { flex: 1, alignItems: 'center' },
  summaryNum:     { fontSize: B + 4, fontWeight: '600' },
  summaryLbl:     { fontSize: S, marginTop: 2 },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
    marginVertical: 4,
  },

  scroll: { paddingBottom: Theme.spacing.xl * 2 },

  sectionLabel: {
    fontSize: S,
    letterSpacing: 1,
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
});
