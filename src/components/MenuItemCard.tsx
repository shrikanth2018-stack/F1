/**
 * 1stOne F1 — MenuItemCard
 * 3-column text row: Name (flex 3) | Price (flex 2, centred) | ADD/stepper (flex 1.5)
 * ADD and stepper controls in green. No boxes, no backgrounds.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';
import { DispatchBadge } from './DispatchBadge';
import { formatPriceShort } from '../utils/formatters';
import type { MenuItem } from '../types';

interface MenuItemCardProps {
  item: MenuItem;
  quantity: number;
  dispatchLabel?: string;
  dispatchScenario?: 'A' | 'B';
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}

export function MenuItemCard({
  item,
  quantity,
  dispatchLabel,
  dispatchScenario,
  onAdd,
  onIncrement,
  onDecrement,
}: MenuItemCardProps) {
  return (
    <View style={styles.row}>
      <View style={styles.colName}>
        <ThemedText variant="body" color="primary">{item.name}</ThemedText>
        {item.description ? (
          <ThemedText variant="small" color="muted">{item.description}</ThemedText>
        ) : null}
        {dispatchLabel && (
          <DispatchBadge
            label={dispatchLabel}
            variant={dispatchScenario === 'A' ? 'today' : 'tomorrow'}
          />
        )}
      </View>

      <View style={styles.colPrice}>
        <ThemedText variant="body" color="mint">{formatPriceShort(item.price)}</ThemedText>
      </View>

      <View style={styles.colAction}>
        {quantity === 0 ? (
          <TouchableOpacity onPress={onAdd} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ThemedText variant="small" style={styles.green}>ADD</ThemedText>
          </TouchableOpacity>
        ) : (
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepBtn} onPress={onDecrement} activeOpacity={0.6}>
              <ThemedText variant="body" style={styles.green}>−</ThemedText>
            </TouchableOpacity>
            <ThemedText variant="body" color="primary" style={styles.qty}>{quantity}</ThemedText>
            <TouchableOpacity style={styles.stepBtn} onPress={onIncrement} activeOpacity={0.6}>
              <ThemedText variant="body" style={styles.green}>+</ThemedText>
            </TouchableOpacity>
          </View>
        )}
      </View>
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
  colName: {
    flex: 3,
  },
  colPrice: {
    flex: 2,
    alignItems: 'center',
  },
  colAction: {
    flex: 1.5,
    alignItems: 'flex-end',
  },
  green: {
    color: Theme.colors.status.success,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepBtn: {
    padding: Theme.spacing.xs,
  },
  qty: {
    minWidth: 22,
    textAlign: 'center',
  },
});
