/**
 * 1stOne F1 — Faded gradient separator
 *
 * Hairline row separator that fades at both ends. Extracted from
 * HomeScreen (audit D22).
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme } from '../../../theme';

export function GradientSep() {
  return (
    <LinearGradient
      colors={['transparent', Theme.colors.layout.divider, 'transparent']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={sep.line}
    />
  );
}

const sep = StyleSheet.create({
  line: { height: StyleSheet.hairlineWidth, width: '100%' },
});
