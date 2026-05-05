/**
 * 1stOne F1 — CompactField
 *
 * Single-row TextInput where the placeholder doubles as the label
 * (e.g. "Mobile Number (10 Digit)"). Non-editable mode renders a Text
 * fallback — muted by default, accent when extracted=true (auto-derived
 * from another field).
 *
 * Commit modes:
 * - onChange: fires on every keystroke (use when parent state mirrors
 *   the field exactly, e.g. OnboardEmployeeScreen).
 * - onCommit: fires on blur / submit only (use for save-on-blur edits,
 *   e.g. EmployeeDetail edit toggle). Internal draft state keeps the
 *   field responsive between commits without spamming the parent.
 *
 * Both can be passed; chip-style consumers (FieldWithSuggestions) call
 * onCommit on chip-tap and the inner field calls it on blur.
 */

import React, { useEffect, useState } from 'react';
import { View, TextInput, KeyboardTypeOptions, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface CompactFieldProps {
  placeholder: string;
  value: string;
  onChange?: (v: string) => void;
  onCommit?: (v: string) => void;
  editable?: boolean;
  extracted?: boolean;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  rightSlot?: React.ReactNode;
}

export function CompactField({
  placeholder,
  value,
  onChange,
  onCommit,
  editable = true,
  extracted = false,
  keyboardType,
  maxLength,
  rightSlot,
}: CompactFieldProps) {
  // Draft state used only when onCommit is provided (commit-on-blur mode).
  // Sync local draft when the upstream value changes (e.g. external save).
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const useDraft = !!onCommit;

  return (
    <View style={styles.row}>
      {editable ? (
        <TextInput
          style={styles.input}
          value={useDraft ? draft : value}
          onChangeText={useDraft ? setDraft : onChange}
          onBlur={useDraft ? () => onCommit!(draft) : undefined}
          onSubmitEditing={useDraft ? () => onCommit!(draft) : undefined}
          placeholder={placeholder}
          placeholderTextColor={Theme.colors.text.muted}
          keyboardType={keyboardType}
          maxLength={maxLength}
          editable={editable}
          returnKeyType="next"
        />
      ) : (
        <ThemedText
          variant="body"
          color={extracted ? 'accent' : 'muted'}
          style={styles.fallback}
        >
          {value || placeholder}
        </ThemedText>
      )}
      {rightSlot ? <View style={styles.rightSlot}>{rightSlot}</View> : null}
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
  input: {
    flex: 1,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 2,
    color: Theme.colors.text.primary,
    paddingVertical: 0,
  },
  fallback: {
    flex: 1,
    fontSize: Theme.typography.sizes.body + 2,
  },
  rightSlot: {
    marginLeft: Theme.spacing.sm,
  },
});
