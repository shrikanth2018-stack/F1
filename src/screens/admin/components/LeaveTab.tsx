/**
 * 1stOne F1 — EmployeeDetail · Leave tab
 *
 * Pending leave approvals (approve / reject) + leave history. Extracted
 * from EmployeeDetailScreen (audit D22).
 */

import React from 'react';
import { confirmDialog, infoDialog } from '../../../utils/confirmDialog';
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
import { useEmployeeLeaves } from '../../../hooks/useResourceManager';
import { formatDate, tab } from './employeeShared';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

export function LeaveTab({ staffId }: { staffId: string }) {
  const { data: leaves = [], isLoading, review } = useEmployeeLeaves(staffId);

  const pending  = leaves.filter((l) => l.status === 'Pending');
  const history  = leaves.filter((l) => l.status !== 'Pending');

  const handleReview = (leaveId: number, status: 'Approved' | 'Rejected') => {
    confirmDialog({
      title: status,
      message: `${status === 'Approved' ? 'Approve' : 'Reject'} this leave request?`,
      confirmLabel: status,
      destructive: status === 'Rejected',
    }).then((ok) => {
      if (!ok) return;
      review.mutate(
        { leaveId, status },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { onError: (e: any) => infoDialog('Error', e?.message) },
      );
    });
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
              style={{ fontSize: S, color: l.status === 'Approved' ? Theme.colors.text.mint : Theme.colors.status.error }}
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
