/**
 * 1stOne F1 — CorrectionRequestModal
 *
 * Staff picks one or more past days on a calendar and submits as a
 * single batch. No per-day time editor — the approve RPC server-side
 * derives the clock-in time from the staff's shift_timing (clock-out
 * stays NULL, which still counts as Present per
 * [[attendance-open-shift]]). Owner spec: days only.
 */

import React, { useState } from 'react';
import {
  View,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { MultiDayCalendar } from '../../../components/MultiDayCalendar';
import { useSubmitAttendanceCorrection } from '../../../hooks/useAttendanceCorrections';

const B = Theme.typography.sizes.body + 1;
const S = Theme.typography.sizes.small + 1;

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmitted?: (requestId: number) => void;
}

export function CorrectionRequestModal({ visible, onClose, onSubmitted }: Props) {
  const submit = useSubmitAttendanceCorrection();

  const [dates, setDates] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const reset = () => {
    setDates([]);
    setReason('');
    setPickerOpen(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    const cleanReason = reason.trim();
    if (!cleanReason) {
      Alert.alert('Reason required', 'Tell admin why you need the backfill.');
      return;
    }
    if (dates.length === 0) {
      Alert.alert('No days selected', 'Tap days on the calendar to mark them.');
      return;
    }

    try {
      const res = await submit.mutateAsync({
        reason: cleanReason,
        days: dates.map((d) => ({ the_date: d })),
      });
      const single = Array.isArray(res) ? res[0] : res;
      onSubmitted?.(single?.request_id ?? 0);
      Alert.alert('Submitted', `${dates.length} day(s) sent to admin for approval.`);
      reset();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Submission failed.';
      Alert.alert('Could not submit', msg);
    }
  };

  // Compact summary of selected dates (first 3 + count).
  const dateSummary = (() => {
    if (dates.length === 0) return 'Tap to pick days';
    const head = dates.slice(0, 3).join(', ');
    return dates.length > 3 ? `${head}  +${dates.length - 3}` : head;
  })();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={st.backdrop}>
        <View style={st.card}>
          <View style={st.header}>
            <ThemedText variant="subtitle" color="primary">Request Attendance Correction</ThemedText>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <ThemedText variant="body" color="muted">Close</ThemedText>
            </TouchableOpacity>
          </View>

          <ThemedText variant="small" color="muted" style={st.hint}>
            Mark the days you forgot to clock in. Times come from your
            shift; admin will approve.
          </ThemedText>

          <ScrollView style={st.body} keyboardShouldPersistTaps="handled">
            <TouchableOpacity
              style={st.row}
              onPress={() => setPickerOpen(true)}
              activeOpacity={0.7}
            >
              <ThemedText variant="body" color="subtitle">Days</ThemedText>
              <ThemedText
                variant="body"
                color={dates.length > 0 ? 'primary' : 'muted'}
                style={st.rowValue}
                numberOfLines={1}
              >
                {dateSummary}
              </ThemedText>
            </TouchableOpacity>

            <ThemedText variant="small" color="muted" style={st.reasonLabel}>Reason</ThemedText>
            <TextInput
              style={st.reasonInput}
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Forgot to clock in — was on the road early"
              placeholderTextColor={Theme.colors.text.muted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </ScrollView>

          <View style={st.footer}>
            <TouchableOpacity onPress={handleClose} disabled={submit.isPending}>
              <ThemedText variant="body" color="muted">Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSubmit} disabled={submit.isPending} activeOpacity={0.7}>
              {submit.isPending
                ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
                : <ThemedText variant="body" color="mint">Submit  ›</ThemedText>}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <MultiDayCalendar
        visible={pickerOpen}
        title="Pick days to correct"
        selected={dates}
        onChange={setDates}
        onClose={() => setPickerOpen(false)}
      />
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Theme.colors.layout.overlayHeavy,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Theme.colors.background.primary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  hint: {
    fontSize: S,
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
    lineHeight: S * 1.4,
  },
  body: {
    paddingHorizontal: Theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    gap: Theme.spacing.sm,
  },
  rowValue: {
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: Theme.spacing.sm,
  },
  reasonLabel: {
    fontSize: S,
    letterSpacing: 1,
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.xs,
  },
  reasonInput: {
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 8,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
    minHeight: 64,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
});
