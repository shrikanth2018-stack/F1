/**
 * 1stOne F1 — SectionRow
 *
 * Horizontal row that aligns a section label (small mint all-caps) with
 * the first input of that section. No bottom border of its own — the
 * child's border (typically a CompactField) does the divider work.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface Props {
  label: string;
  children: React.ReactNode;
}

export function SectionRow({ label, children }: Props) {
  return (
    <View style={styles.row}>
      <ThemedText variant="small" color="mint" style={styles.label}>
        {label}
      </ThemedText>
      <View style={styles.child}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    width: 110,
    paddingLeft: Theme.spacing.md,
    fontSize: Theme.typography.sizes.small,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  child: {
    flex: 1,
  },
});
