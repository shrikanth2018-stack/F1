/**
 * 1stOne F1 — MenuItemCard
 *
 * Displays a single menu item with image, name, description, price,
 * and add-to-cart / quantity stepper.
 *
 * Uses display_price only (server recalculates at checkout).
 * Shows DispatchBadge (Today/Tomorrow) per Smart Cart evaluation.
 */

import React from 'react';
import { View, Image, StyleSheet, TouchableOpacity } from 'react-native';
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
    <View style={styles.card}>
      {item.image_url ? (
        <Image source={{ uri: item.image_url }} style={styles.image} />
      ) : (
        <View style={[styles.image, styles.placeholder]} />
      )}

      <View style={styles.info}>
        <View style={styles.topRow}>
          <ThemedText variant="body" color="primary" style={styles.name}>
            {item.name}
          </ThemedText>
          {dispatchLabel && (
            <DispatchBadge
              label={dispatchLabel}
              variant={dispatchScenario === 'A' ? 'today' : 'tomorrow'}
            />
          )}
        </View>

        {item.description ? (
          <ThemedText variant="small" color="muted" style={styles.desc}>
            {item.description}
          </ThemedText>
        ) : null}

        <View style={styles.bottomRow}>
          <ThemedText variant="subtitle" color="accent">
            {formatPriceShort(item.price)}
          </ThemedText>

          {quantity === 0 ? (
            <TouchableOpacity
              style={styles.addButton}
              activeOpacity={0.7}
              onPress={onAdd}
            >
              <ThemedText variant="small" color="primary">
                ADD
              </ThemedText>
            </TouchableOpacity>
          ) : (
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={onDecrement}
                activeOpacity={0.7}
              >
                <ThemedText variant="body" color="primary">
                  −
                </ThemedText>
              </TouchableOpacity>

              <ThemedText variant="body" color="primary" style={styles.qty}>
                {quantity}
              </ThemedText>

              <TouchableOpacity
                style={styles.stepBtn}
                onPress={onIncrement}
                activeOpacity={0.7}
              >
                <ThemedText variant="body" color="primary">
                  +
                </ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Theme.colors.background.card,
    borderRadius: Theme.components.inputRadius,
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
    overflow: 'hidden',
  },
  image: {
    width: 100,
    height: 100,
  },
  placeholder: {
    backgroundColor: Theme.colors.background.input,
  },
  info: {
    flex: 1,
    padding: Theme.spacing.sm,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  name: {
    flex: 1,
    marginRight: Theme.spacing.xs,
  },
  desc: {
    marginTop: 2,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Theme.spacing.xs,
  },
  addButton: {
    backgroundColor: Theme.colors.action.primary,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.action.primary,
    borderRadius: 8,
  },
  stepBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  qty: {
    minWidth: 24,
    textAlign: 'center',
  },
});
