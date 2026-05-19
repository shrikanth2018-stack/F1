/**
 * 1stOne F1 — Home item rows
 *
 * Compact add-to-cart rows for the Home screen — FoodRow (menu items) and
 * EssentialRow (essentials), each with an outlined ADD button / stepper.
 * Extracted from HomeScreen (audit D22).
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../../../theme';
import { formatPriceShort } from '../../../utils/formatters';
import type { MenuItem, EssentialItem } from '../../../types';
import { GradientSep } from './GradientSep';

interface FoodRowProps {
  item: MenuItem;
  qty: number;
  dispatchLabel?: string;
  isLast: boolean;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}

export function FoodRow({ item, qty, dispatchLabel, isLast, onAdd, onIncrement, onDecrement }: FoodRowProps) {
  return (
    <>
      <View style={styles.itemRow}>
        <Ionicons name="restaurant-outline" size={17} color={Theme.colors.text.mint} style={styles.rowIcon} />
        <View style={styles.itemMeta}>
          <Text style={styles.itemName}>{item.name}</Text>
          {dispatchLabel ? <Text style={styles.itemSub}>{dispatchLabel}</Text> : null}
        </View>
        <Text style={styles.itemPrice}>{formatPriceShort(item.price)}</Text>
        {qty === 0 ? (
          <TouchableOpacity style={styles.addCircle} onPress={onAdd} activeOpacity={0.6}>
            <Text style={styles.addPlus}>+</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.stepper}>
            <TouchableOpacity onPress={onDecrement} activeOpacity={0.5} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.stepperBtn}>−</Text>
            </TouchableOpacity>
            <Text style={styles.qtyText}>{qty}</Text>
            <TouchableOpacity onPress={onIncrement} activeOpacity={0.5} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.stepperBtn}>+</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {!isLast && <GradientSep />}
    </>
  );
}

interface EssentialRowProps {
  item: EssentialItem;
  qty: number;
  isLast: boolean;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}

export function EssentialRow({ item, qty, isLast, onAdd, onIncrement, onDecrement }: EssentialRowProps) {
  return (
    <>
      <View style={styles.itemRow}>
        <Ionicons name="basket-outline" size={17} color={Theme.colors.text.mint} style={styles.rowIcon} />
        <View style={styles.itemMeta}>
          <Text style={styles.itemName}>{item.name}</Text>
          {item.description ? <Text style={styles.itemSub}>{item.description}</Text> : null}
        </View>
        <Text style={styles.itemPrice}>{formatPriceShort(item.price)}</Text>
        {qty === 0 ? (
          <TouchableOpacity style={styles.addCircle} onPress={onAdd} activeOpacity={0.6}>
            <Text style={styles.addPlus}>+</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.stepper}>
            <TouchableOpacity onPress={onDecrement} activeOpacity={0.5} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.stepperBtn}>−</Text>
            </TouchableOpacity>
            <Text style={styles.qtyText}>{qty}</Text>
            <TouchableOpacity onPress={onIncrement} activeOpacity={0.5} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.stepperBtn}>+</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {!isLast && <GradientSep />}
    </>
  );
}

const styles = StyleSheet.create({
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.xs,
    paddingVertical: 11,
  },
  rowIcon: {
    marginRight: Theme.spacing.sm,
    flexShrink: 0,
  },
  itemMeta: { flex: 1, marginRight: Theme.spacing.sm },
  itemName: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 2,
    color: Theme.colors.text.primary,
    fontWeight: '400',
  },
  itemSub: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small + 2,
    color: Theme.colors.text.muted,
    marginTop: 2,
  },
  itemPrice: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 2,
    color: Theme.colors.text.mint,
    marginRight: Theme.spacing.md,
    flexShrink: 0,
  },
  // ── Outlined circle ADD button ──
  addCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: Theme.colors.text.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlus: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 4,
    color: Theme.colors.text.mint,
    fontWeight: '300',
    marginTop: -1,
  },
  // ── Borderless stepper ──
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.xs },
  stepperBtn: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.subtitle + 2,
    color: Theme.colors.text.mint,
    fontWeight: '300',
    lineHeight: Theme.typography.sizes.subtitle + 4,
    minWidth: 18,
    textAlign: 'center',
  },
  qtyText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 2,
    color: Theme.colors.text.primary,
    minWidth: 20,
    textAlign: 'center',
    fontWeight: '400',
  },
});
