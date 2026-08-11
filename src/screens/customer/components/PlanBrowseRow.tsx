/**
 * 1stOne F1 — Plan row for the Subscription tab on Home
 *
 * Subscription moved out of a floating button and onto the main switch, so
 * plans are now browsed in the same place as food and essentials rather than
 * behind an overlay that sat on top of the menu.
 *
 * THE PER-DAY PRICE IS THE POINT. Breakfast 30 is ₹1,250, which reads as
 * expensive next to a ₹50 idli. It is ₹41.67 a day — cheaper than buying the
 * same breakfast à la carte. That comparison is the entire business case for
 * the subscription model this app is built around, and until now it appeared
 * nowhere in the product.
 */

import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { CatalogPhotoThumb } from '../../../components/CatalogPhotoThumb';
import { PHOTO_BUCKET, PHOTO_PX } from '../../../utils/catalogPhoto';
import { formatPriceShort } from '../../../utils/formatters';
import type { SubscriptionPlan } from '../../../types';

/** Matches the food and essentials rows, so the three tabs share one rhythm. */
const THUMB = 66;

interface Props {
  plan: SubscriptionPlan;
  isLast: boolean;
  onPress: () => void;
}

export function PlanBrowseRow({ plan, isLast, onPress }: Props) {
  const days = plan.duration_days ?? 0;
  const perDay = days > 0 ? (plan.price ?? 0) / days : null;

  return (
    <TouchableOpacity
      style={[styles.row, isLast && styles.rowLast]}
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
    >
      {/* Calendar, not a plate: a plan is a schedule, and the same dish
          photographed for its menu row would read as a single meal. */}
      <CatalogPhotoThumb
        bucket={PHOTO_BUCKET.plans}
        item={plan}
        size={THUMB}
        requestPx={PHOTO_PX.row}
        fallbackIcon="calendar-outline"
      />

      <View style={styles.meta}>
        <ThemedText variant="body" color="primary" style={styles.name}>
          {plan.plan_name}
        </ThemedText>
        <ThemedText variant="small" color="muted" style={styles.sub}>
          {days} days
          {plan.plan_type ? ` · ${plan.plan_type === 'essentials' ? 'Essentials' : 'Food'}` : ''}
        </ThemedText>
      </View>

      <View style={styles.priceWrap}>
        <ThemedText variant="body" color="mint" style={styles.price}>
          {formatPriceShort(plan.price ?? 0)}
        </ThemedText>
        {perDay != null && (
          <ThemedText variant="small" color="muted" style={styles.perDay}>
            ₹{perDay.toFixed(0)}/day
          </ThemedText>
        )}
      </View>

      <ThemedText variant="body" color="mint" style={styles.chev}>›</ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  rowLast: { borderBottomWidth: 0 },
  meta: { flex: 1, marginLeft: Theme.spacing.md, marginRight: Theme.spacing.sm },
  name: { fontSize: Theme.typography.sizes.body + 1 },
  sub: { marginTop: 2 },
  priceWrap: { alignItems: 'flex-end', marginRight: Theme.spacing.sm },
  price: { fontSize: Theme.typography.sizes.body + 1 },
  perDay: { marginTop: 2 },
  chev: { fontSize: Theme.typography.sizes.subtitle },
});
