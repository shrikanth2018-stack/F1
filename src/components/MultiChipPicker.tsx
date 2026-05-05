/**
 * 1stOne F1 — MultiChipPicker
 *
 * Wrap-flow multi-select chip group. Used for benefits selection on
 * OnboardEmployeeScreen and EmployeeDetailScreen. Tap a chip to toggle
 * its membership; active chips show a checkmark prefix in mint.
 *
 * editable=false hides the chip group (display shows nothing visible
 * besides the optional label) — use the standalone "Selected:" line
 * in the consumer if you need a read-only summary.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface Props {
  label?: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  editable?: boolean;
}

const S = Theme.typography.sizes.small + 2;

export function MultiChipPicker({
  label,
  options,
  selected,
  onToggle,
  editable = true,
}: Props) {
  return (
    <View style={styles.container}>
      {label ? (
        <ThemedText variant="small" color="muted" style={styles.label}>{label}</ThemedText>
      ) : null}
      <View style={styles.wrap}>
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => editable && onToggle(opt)}
              activeOpacity={editable ? 0.7 : 1}
              disabled={!editable}
            >
              <ThemedText
                variant="small"
                color={active ? 'primary' : 'muted'}
                style={[styles.txt, active && styles.txtActive]}
              >
                {active ? '✓  ' : ''}{opt}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  label: {
    fontSize: S,
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: Theme.spacing.md,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: Theme.spacing.md,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  chipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },
  txt: { fontSize: S },
  txtActive: { color: Theme.colors.text.mint, fontWeight: '600' },
});
