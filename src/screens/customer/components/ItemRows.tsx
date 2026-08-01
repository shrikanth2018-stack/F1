/**
 * 1stOne F1 — Home item rows
 *
 * Compact add-to-cart rows for the Home screen — FoodRow (menu items) and
 * EssentialRow (essentials), each with an outlined ADD button / stepper.
 * Extracted from HomeScreen (audit D22).
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Theme } from '../../../theme';
import { formatPriceShort } from '../../../utils/formatters';
import type { MenuItem, EssentialItem } from '../../../types';
import { CatalogPhotoThumb } from '../../../components/CatalogPhotoThumb';
import { PHOTO_BUCKET, PHOTO_PX } from '../../../utils/catalogPhoto';
import { GradientSep } from './GradientSep';

/**
 * Row photo tile, in points. 76 is the size at which the supplied dish and
 * product renders stay identifiable (a thali at 44 is a smudge) without
 * dropping the list below ~6 items a screen. Both catalogues use the same
 * value so Food and Essentials scroll at the same rhythm.
 */
const THUMB = 76;

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
      <View style={styles.foodRow}>
        <CatalogPhotoThumb
          bucket={PHOTO_BUCKET.menu}
          item={item}
          size={THUMB}
          requestPx={PHOTO_PX.row}
          fallbackIcon="restaurant-outline"
        />
        <View style={styles.foodMeta}>
          <Text style={styles.itemName}>{item.name}</Text>
          {/* Description first — it is what the customer is choosing between.
              The dispatch label stays below it, still the last word before
              they add to cart. */}
          {item.description ? (
            <Text style={styles.itemSub} numberOfLines={2}>{item.description}</Text>
          ) : null}
          {dispatchLabel ? <Text style={styles.itemDispatch}>{dispatchLabel}</Text> : null}
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
      <View style={styles.foodRow}>
        <CatalogPhotoThumb
          bucket={PHOTO_BUCKET.essentials}
          item={item}
          size={THUMB}
          requestPx={PHOTO_PX.row}
          fallbackIcon="basket-outline"
        />
        <View style={styles.foodMeta}>
          <Text style={styles.itemName}>{item.name}</Text>
          {item.description ? (
            <Text style={styles.itemSub} numberOfLines={2}>{item.description}</Text>
          ) : null}
          {/* Attribution is the safeguard that makes third-party selling
              honest — the customer should know who they are buying from. It
              now sits on its own line rather than replacing the description:
              with a photo present, "what is it" and "who sells it" are
              different questions and the row has room for both. */}
          {item.vendor_name ? (
            <Text style={styles.itemDispatch}>Sold by {item.vendor_name}</Text>
          ) : null}
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
  // Food rows carry a 76pt tile, so they breathe more than the compact
  // essentials row and align to the top of the text block rather than centre.
  foodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.xs,
    paddingVertical: Theme.spacing.sm + 2,
  },
  foodMeta: {
    flex: 1,
    marginLeft: Theme.spacing.md,
    marginRight: Theme.spacing.sm,
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
  // Dispatch timing is operational, not descriptive — held apart from the
  // description in mint so it still reads as the actionable line.
  itemDispatch: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small,
    color: Theme.colors.text.mint,
    marginTop: 3,
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
