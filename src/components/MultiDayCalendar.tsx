/**
 * 1stOne F1 — MultiDayCalendar
 *
 * Bottom-sheet calendar with multi-day selection. Inline (no Confirm
 * step) — taps toggle dates in the selection set; parent gets the
 * updated array on every change. Future dates are blocked by default
 * (corrections are for past days only); pass `allowFuture` to lift.
 *
 * Output: array of 'YYYY-MM-DD' strings.
 */

import React, { useState } from 'react';
import { Modal, View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface Props {
  visible: boolean;
  title: string;
  selected: string[];
  onChange: (dates: string[]) => void;
  onClose: () => void;
  allowFuture?: boolean;
}

export function MultiDayCalendar({
  visible,
  title,
  selected,
  onChange,
  onClose,
  allowFuture = false,
}: Props) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const initDate = selected[0] ? new Date(selected[0] + 'T00:00:00') : today;
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());

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

  const toggle = (ds: string) => {
    if (!allowFuture && ds > todayStr) return;
    const next = selected.includes(ds) ? selected.filter((d) => d !== ds) : [...selected, ds];
    onChange(next.sort());
  };

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
              const isPicked = selected.includes(ds);
              const isFuture = !allowFuture && ds > todayStr;
              return (
                <TouchableOpacity
                  key={ds}
                  style={[s.cell, isPicked && s.cellPicked]}
                  onPress={() => toggle(ds)}
                  disabled={isFuture}
                >
                  <Text style={[
                    s.dayText,
                    isPicked && s.dayTextPicked,
                    isFuture && s.dayTextFuture,
                  ]}>{day}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <ThemedText variant="small" color="muted" style={s.hint}>
            {selected.length} day{selected.length === 1 ? '' : 's'} selected. Tap to toggle.
          </ThemedText>

          <View style={s.footer}>
            <TouchableOpacity onPress={() => onChange([])}>
              <ThemedText variant="body" color="muted">Clear</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose}>
              <ThemedText variant="body" color="mint">Done</ThemedText>
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
  dayTextFuture: { color: Theme.colors.text.disabled },
  hint: {
    textAlign: 'center',
    marginTop: Theme.spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
});
