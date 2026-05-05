/**
 * 1stOne F1 — CompactTimeRangeField
 *
 * Two time pickers ("Start Time" / "End Time") in one row.
 * Stores the range as "HH:MM-HH:MM" (e.g. "06:00-14:00") so
 * the existing single shift_timing column keeps its shape.
 */

import React, { useState } from 'react';
import { Pressable, Platform, StyleSheet, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface Props {
  value: string;             // "HH:MM-HH:MM" or empty
  onChange: (v: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const parseRange = (s: string): { start: string; end: string } => {
  const m = s.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  return m ? { start: m[1], end: m[2] } : { start: '', end: '' };
};

const toDate = (hhmm: string): Date => {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  const d = new Date();
  d.setSeconds(0, 0);
  if (m) {
    d.setHours(Number(m[1]), Number(m[2]));
  } else {
    d.setHours(9, 0); // sensible default for time picker initial value
  }
  return d;
};

export function CompactTimeRangeField({ value, onChange }: Props) {
  const { start, end } = parseRange(value);
  const [openSlot, setOpenSlot] = useState<'start' | 'end' | null>(null);

  const apply = (slot: 'start' | 'end', next: string) => {
    const merged = slot === 'start' ? `${next}-${end || next}` : `${start || next}-${next}`;
    onChange(merged);
  };

  const handleChange = (slot: 'start' | 'end') => (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setOpenSlot(null);
      if (event.type === 'set' && selected) apply(slot, fmt(selected));
      return;
    }
    if (event.type === 'set' || event.type === 'dismissed') setOpenSlot(null);
    if (event.type === 'set' && selected) apply(slot, fmt(selected));
  };

  return (
    <View>
      <View style={styles.row}>
        <Pressable onPress={() => setOpenSlot('start')} style={styles.cell}>
          <ThemedText
            variant="body"
            color={start ? 'primary' : 'muted'}
            style={styles.cellText}
          >
            {start || 'Start Time'}
          </ThemedText>
        </Pressable>
        <View style={styles.divider} />
        <Pressable onPress={() => setOpenSlot('end')} style={styles.cell}>
          <ThemedText
            variant="body"
            color={end ? 'primary' : 'muted'}
            style={styles.cellText}
          >
            {end || 'End Time'}
          </ThemedText>
        </Pressable>
      </View>
      {openSlot && (
        <DateTimePicker
          value={toDate(openSlot === 'start' ? start : end)}
          mode="time"
          display="default"
          is24Hour
          onChange={handleChange(openSlot)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  cell: {
    flex: 1,
    paddingVertical: Theme.spacing.xs,
  },
  cellText: {
    fontSize: Theme.typography.sizes.body + 2,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: Theme.colors.layout.divider,
    marginHorizontal: Theme.spacing.sm,
  },
});
