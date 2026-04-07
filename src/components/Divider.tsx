/**
 * 1stOne F1 — Divider
 * Thin semi-transparent white line separator.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Theme } from '../theme';

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
    marginVertical: Theme.spacing.sm,
  },
});
