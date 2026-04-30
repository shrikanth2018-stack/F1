/**
 * 1stOne F1 — In-app numeric keypad
 *
 * iOS-passcode-style 3×4 grid. Renders inline, themed in the app's dark
 * mode, replacing the OS keyboard for phone-number / OTP entry.
 *
 *  - No special characters, no decimal — pure 0-9 + backspace
 *  - No flicker (no OS keyboard to pop in/out)
 *  - Same visual treatment across iOS and Android
 *
 * Usage:
 *   <NumberKeypad
 *     value={phone}
 *     onChange={setPhone}
 *     maxLength={10}
 *   />
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Theme } from '../theme';

interface NumberKeypadProps {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
}

const ROWS: (string | null)[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [null, '0', 'BACK'],   // null = empty cell, 'BACK' = backspace
];

export function NumberKeypad({ value, onChange, maxLength = 10 }: NumberKeypadProps) {
  const handlePress = (key: string | null) => {
    if (key === null) return;
    if (key === 'BACK') {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= maxLength) return;
    onChange(value + key);
  };

  return (
    <View style={styles.grid}>
      {ROWS.map((row, rIdx) => (
        <View key={rIdx} style={styles.row}>
          {row.map((key, cIdx) => {
            if (key === null) {
              return <View key={cIdx} style={styles.cell} />;
            }
            if (key === 'BACK') {
              return (
                <TouchableOpacity
                  key={cIdx}
                  style={styles.cell}
                  activeOpacity={0.4}
                  onPress={() => handlePress('BACK')}
                  accessibilityLabel="Backspace"
                  accessibilityRole="button"
                >
                  <Text style={styles.backIcon}>⌫</Text>
                </TouchableOpacity>
              );
            }
            return (
              <TouchableOpacity
                key={cIdx}
                style={styles.cell}
                activeOpacity={0.4}
                onPress={() => handlePress(key)}
                accessibilityLabel={`Number ${key}`}
                accessibilityRole="button"
              >
                <Text style={styles.digit}>{key}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    width: '100%',
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cell: {
    flex: 1,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: 32,
    color: Theme.colors.text.primary,
    fontWeight: '300',
  },
  backIcon: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: 28,
    color: Theme.colors.text.muted,
  },
});
