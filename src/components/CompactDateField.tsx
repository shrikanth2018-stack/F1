/**
 * 1stOne F1 — CompactDateField
 *
 * Pressable row that opens the native DateTimePicker. Stores YYYY-MM-DD
 * strings outside; converts to/from Date internally.
 *
 * Android: picker is one-shot — closes on select or dismiss.
 * iOS: closes on event.type === 'set' or 'dismissed'.
 */

import React, { useState } from 'react';
import { Pressable, Platform, StyleSheet, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface Props {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string): Date => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

export function CompactDateField({ placeholder, value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setOpen(false);
      if (event.type === 'set' && selected) {
        onChange(toIso(selected));
      }
      return;
    }
    if (event.type === 'set' || event.type === 'dismissed') {
      setOpen(false);
    }
    if (event.type === 'set' && selected) {
      onChange(toIso(selected));
    }
  };

  return (
    <View>
      <Pressable onPress={() => setOpen(true)} style={styles.row}>
        <ThemedText
          variant="body"
          color={value ? 'primary' : 'muted'}
          style={styles.text}
        >
          {value || placeholder}
        </ThemedText>
      </Pressable>
      {open && (
        <DateTimePicker
          value={fromIso(value)}
          mode="date"
          display="default"
          onChange={handleChange}
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
  text: {
    flex: 1,
    fontSize: Theme.typography.sizes.body + 2,
  },
});
