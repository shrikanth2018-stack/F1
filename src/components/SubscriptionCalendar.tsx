/**
 * 1stOne F1 — SubscriptionCalendar
 *
 * Simple month-view calendar for skip/unskip days.
 * Shows: active days (green), skipped days (red), past days (gray).
 * Tap a future date to toggle skip.
 */

import React, { useState, useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface SubscriptionCalendarProps {
  startDate: string;           // YYYY-MM-DD
  durationDays: number;
  cancelledDates: string[];    // YYYY-MM-DD[]
  onToggleDate: (date: string) => void;
}

export function SubscriptionCalendar({
  startDate,
  durationDays,
  cancelledDates,
  onToggleDate,
}: SubscriptionCalendarProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + durationDays - 1);

  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const cancelledSet = useMemo(
    () => new Set(cancelledDates),
    [cancelledDates]
  );

  // Generate calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewMonth.year, viewMonth.month, 1);
    const lastDay = new Date(viewMonth.year, viewMonth.month + 1, 0);
    const startPad = firstDay.getDay(); // 0=Sun

    const days: Array<{ date: Date | null; key: string }> = [];

    // Padding before month starts
    for (let i = 0; i < startPad; i++) {
      days.push({ date: null, key: `pad-${i}` });
    }

    // Actual days
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(viewMonth.year, viewMonth.month, d);
      days.push({ date, key: date.toISOString().split('T')[0] });
    }

    return days;
  }, [viewMonth]);

  const prevMonth = () => {
    setViewMonth((prev) => {
      const m = prev.month - 1;
      return m < 0
        ? { year: prev.year - 1, month: 11 }
        : { year: prev.year, month: m };
    });
  };

  const nextMonth = () => {
    setViewMonth((prev) => {
      const m = prev.month + 1;
      return m > 11
        ? { year: prev.year + 1, month: 0 }
        : { year: prev.year, month: m };
    });
  };

  const monthLabel = new Date(viewMonth.year, viewMonth.month).toLocaleDateString(
    'en-IN',
    { month: 'long', year: 'numeric' }
  );

  return (
    <View style={styles.container}>
      {/* Month Navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={prevMonth}>
          <ThemedText variant="body" color="accent">‹</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="subtitle" color="primary">
          {monthLabel}
        </ThemedText>
        <TouchableOpacity onPress={nextMonth}>
          <ThemedText variant="body" color="accent">›</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Day Headers */}
      <View style={styles.weekRow}>
        {DAYS_OF_WEEK.map((d) => (
          <ThemedText key={d} variant="micro" color="muted" style={styles.dayHeader}>
            {d}
          </ThemedText>
        ))}
      </View>

      {/* Calendar Grid */}
      <View style={styles.grid}>
        {calendarDays.map(({ date, key }) => {
          if (!date) {
            return <View key={key} style={styles.cell} />;
          }

          const dateStr = key; // YYYY-MM-DD
          const isPast = date < today;
          const isInSubscription = date >= start && date <= end;
          const isCancelled = cancelledSet.has(dateStr);
          const isFuture = date >= today;
          const canToggle = isInSubscription && isFuture;

          let bgColor = 'transparent';
          let textColor: 'primary' | 'muted' | 'accent' = 'muted';

          if (isInSubscription) {
            if (isCancelled) {
              bgColor = Theme.colors.status.error;
              textColor = 'primary';
            } else if (isPast) {
              bgColor = Theme.colors.status.success + '40'; // 25% opacity
              textColor = 'primary';
            } else {
              bgColor = Theme.colors.status.success;
              textColor = 'primary';
            }
          }

          const isToday = date.toDateString() === today.toDateString();

          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.cell,
                { backgroundColor: bgColor },
                isToday && styles.todayBorder,
              ]}
              disabled={!canToggle}
              activeOpacity={0.6}
              onPress={() => canToggle && onToggleDate(dateStr)}
            >
              <ThemedText variant="small" color={textColor}>
                {date.getDate()}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Theme.colors.status.success }]} />
          <ThemedText variant="micro" color="muted">Active</ThemedText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Theme.colors.status.error }]} />
          <ThemedText variant="micro" color="muted">Skipped</ThemedText>
        </View>
      </View>
    </View>
  );
}

const CELL_SIZE = 40;

const styles = StyleSheet.create({
  container: {
    padding: Theme.spacing.sm,
  },
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.xs,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 4,
  },
  dayHeader: {
    width: CELL_SIZE,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    height: CELL_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  todayBorder: {
    borderWidth: 1.5,
    borderColor: Theme.colors.action.primary,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: Theme.spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
