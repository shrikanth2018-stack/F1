/**
 * 1stOne F1 — CompactFieldWithSuggestions
 *
 * CompactField + horizontal scroll chip row beneath. Tapping a chip
 * fills the field's value. Chips and the chip row hide when
 * editable=false (display-only mode).
 *
 * onChange fires on every keystroke (chip taps too — atomic).
 * onCommit, when provided, fires on inner-field blur and on chip taps
 * — use this when you want save-on-blur semantics (e.g. EmployeeDetail
 * edit toggle).
 */

import React from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';
import { CompactField } from './CompactField';

interface Props {
  placeholder: string;
  value: string;
  onChange?: (v: string) => void;
  onCommit?: (v: string) => void;
  suggestions: string[];
  editable?: boolean;
}

export function CompactFieldWithSuggestions({
  placeholder,
  value,
  onChange,
  onCommit,
  suggestions,
  editable = true,
}: Props) {
  const handleChip = (s: string) => {
    onChange?.(s);
    onCommit?.(s);
  };

  return (
    <View>
      <CompactField
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        editable={editable}
      />
      {editable && suggestions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {suggestions.map((s) => {
            const active = value === s;
            return (
              <TouchableOpacity
                key={s}
                onPress={() => handleChip(s)}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.7}
              >
                <ThemedText
                  variant="small"
                  color={active ? 'mint' : 'muted'}
                >
                  {s}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    paddingRight: Theme.spacing.md + Theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  chipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },
});
