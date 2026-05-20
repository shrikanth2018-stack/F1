/**
 * 1stOne F1 — CalendarPicker
 *
 * Bottom-sheet single-day picker. Promoted from StaffAttendanceScreen
 * so the AttendanceCorrection modal (and any future caller) can reuse
 * the same UX. Same look + behaviour, no functional change from the
 * original embedded version — only the location.
 *
 * Output format: 'YYYY-MM-DD' string.
 */

import React, { useState } from 'react';
import { Modal, View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface Props {
  visible: boolean;
  title: string;
  selected: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}

export function CalendarPicker({ visible, title, selected, onSelect, onClose }: Props) {
  const today = new Date();
  const initDate = selected ? new Date(selected + 'T00:00:00') : today;
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());
  const [picked, setPicked] = useState<string>(selected);

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric',
  });

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const blanks = firstDay;
  const cells: (number | null)[] = [
    ...Array(blanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.box}>
          <ThemedText variant="body" color="muted" style={s.title}>{title}</ThemedText>

          <View style={s.navRow}>
            <TouchableOpacity onPress={prevMonth}><ThemedText variant="body" color="accent">‹</ThemedText></TouchableOpacity>
            <ThemedText variant="body" color="primary">{monthLabel}</ThemedText>
            <TouchableOpacity onPress={nextMonth}><ThemedText variant="body" color="accent">›</ThemedText></TouchableOpacity>
          </View>

          <View style={s.grid}>
            {DAYS.map((d) => (
              <Text key={d} style={s.dayHeader}>{d}</Text>
            ))}
            {cells.map((day, idx) => {
              if (!day) return <View key={`b${idx}`} style={s.cell} />;
              const ds = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isPicked = ds === picked;
              return (
                <TouchableOpacity
                  key={ds}
                  style={[s.cell, isPicked && s.cellPicked]}
                  onPress={() => setPicked(ds)}
                >
                  <Text style={[s.dayText, isPicked && s.dayTextPicked]}>{day}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={s.footer}>
            <TouchableOpacity onPress={onClose}>
              <ThemedText variant="body" color="muted">Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { onSelect(picked); onClose(); }}>
              <ThemedText variant="body" color="mint">Confirm</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Theme.colors.layout.overlayMedium,
    justifyContent: 'flex-end',
  },
  box: {
    backgroundColor: Theme.colors.background.secondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },
  title: { textAlign: 'center', marginBottom: Theme.spacing.sm, letterSpacing: 1 },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayHeader: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: Theme.colors.text.muted,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small,
    paddingVertical: 4,
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellPicked: {
    backgroundColor: Theme.colors.text.mint,
    borderRadius: 20,
  },
  dayText: {
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
  },
  dayTextPicked: { color: Theme.colors.background.primary },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
});
