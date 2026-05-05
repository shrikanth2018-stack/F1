/**
 * 1stOne F1 — CompactDateField
 *
 * Pressable row that opens the native DateTimePicker. Stores
 * YYYY-MM-DD strings outside; converts to/from Date internally.
 *
 * Android: picker is one-shot — closes on select or dismiss
 *   (the @react-native-community/datetimepicker auto-shows a
 *   native modal on Android when mounted).
 * iOS: spinner shown inside our own bottom-sheet Modal with a
 *   Done button. iOS's "default" / "compact" displays render
 *   inline rather than as a modal, so wrapping is needed for the
 *   Pressable trigger pattern to feel like a real picker.
 */

import React, { useState } from 'react';
import { Pressable, Platform, StyleSheet, View, Modal, TouchableOpacity } from 'react-native';
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

const isIos = Platform.OS === 'ios';

export function CompactDateField({ placeholder, value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const handleChangeAndroid = (event: DateTimePickerEvent, selected?: Date) => {
    setOpen(false);
    if (event.type === 'set' && selected) {
      onChange(toIso(selected));
    }
  };

  const handleChangeIos = (_event: DateTimePickerEvent, selected?: Date) => {
    if (selected) onChange(toIso(selected));
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

      {isIos ? (
        <Modal
          transparent
          visible={open}
          animationType="slide"
          onRequestClose={() => setOpen(false)}
        >
          <Pressable style={sheet.backdrop} onPress={() => setOpen(false)}>
            <Pressable style={sheet.body} onPress={() => {}}>
              <View style={sheet.header}>
                <TouchableOpacity onPress={() => setOpen(false)}>
                  <ThemedText variant="body" color="mint" style={sheet.done}>Done</ThemedText>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={fromIso(value)}
                mode="date"
                display="spinner"
                textColor={Theme.colors.text.primary}
                onChange={handleChangeIos}
                style={sheet.picker}
              />
            </Pressable>
          </Pressable>
        </Modal>
      ) : (
        open && (
          <DateTimePicker
            value={fromIso(value)}
            mode="date"
            display="default"
            onChange={handleChangeAndroid}
          />
        )
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

const sheet = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Theme.colors.layout.overlayHeavy,
    justifyContent: 'flex-end',
  },
  body: {
    backgroundColor: Theme.colors.background.secondary,
    paddingBottom: Theme.spacing.lg,
  },
  picker: {
    width: '100%',
    height: 216,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  done: {
    fontSize: Theme.typography.sizes.body + 2,
    fontWeight: '600',
  },
});
