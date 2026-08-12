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
import { GradientSep } from './GradientSep';
// Read, not copied. This row had drifted from Food and Essentials on four
// counts — row height, inset, subtext size and the separator itself. See
// homeRow.ts.
import { HOME_ROW } from './homeRow';

const THUMB = HOME_ROW.thumb;

interface Props {
  plan: SubscriptionPlan;
  isLast: boolean;
  onPress: () => void;
}

export function PlanBrowseRow({ plan, isLast, onPress }: Props) {
  const days = plan.duration_days ?? 0;
  const perDay = days > 0 ? (plan.price ?? 0) / days : null;

  return (
    <>
    <TouchableOpacity
      style={styles.row}
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
    {/* The same faded rule Food and Essentials use, between rows and not under
        the last — this row used to draw a flat hairline border on itself and
        switch it off with `isLast`. */}
    {!isLast && <GradientSep />}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: HOME_ROW.paddingHorizontal,
    paddingVertical: HOME_ROW.paddingVertical,
  },
  meta: { flex: 1, marginLeft: HOME_ROW.metaLeft, marginRight: HOME_ROW.metaRight },
  name: { fontSize: HOME_ROW.nameSize },
  sub: { marginTop: 2, fontSize: HOME_ROW.subSize },
  priceWrap: { alignItems: 'flex-end', marginRight: Theme.spacing.sm },
  price: { fontSize: HOME_ROW.priceSize },
  perDay: { marginTop: 2, fontSize: HOME_ROW.subSize },
  chev: { fontSize: Theme.typography.sizes.subtitle },
});
