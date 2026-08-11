/**
 * 1stOne F1 — Cycle group
 *
 * A delivery cycle's labelled group of item rows, with a staggered
 * spring-in entrance. Extracted from HomeScreen (audit D22).
 */

import React, { useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import type { SectionMeta } from './homeShared';

interface CycleGroupProps {
  section: SectionMeta;
  index: number;
  onOpenPopup: (s: SectionMeta) => void;
  /**
   * Server-derived delivery day for this cycle — 'Today' / 'Tomorrow' /
   * 'Day after tomorrow'.
   *
   * The header used to read "Dispatch by 7:30 AM" with no day at all. At
   * 09:45 that is unreadable: breakfast at 7:30 can only mean tomorrow, but
   * the customer had no way to know until they had already added something,
   * because the day was disclosed on the ITEM row after adding. Naming it up
   * front is the difference between choosing and guessing.
   *
   * Rendered BELOW the dispatch time rather than inline before it — see the
   * note at the call site.
   *
   * Comes from useCycleDispatch (the cycle-dispatch edge function), never
   * from the device clock — the same A/B/C rule the order path uses.
   */
  dayLabel?: string;
  children: React.ReactNode;
}

export function CycleGroup({ section, index, onOpenPopup, dayLabel, children }: CycleGroupProps) {
  // Reanimated worklets — runs on UI thread, no JS-thread contention
  // (mixing classic Animated with multiple staggered setTimeouts caused
  // visible stutter on real Android devices, while iOS sim hid it.)
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    const t = setTimeout(() => {
      opacity.value = withTiming(1, { duration: 280 });
      translateY.value = withSpring(0, { damping: 13, stiffness: 170, mass: 0.8 });
    }, index * 80 + 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <ReAnimated.View style={[styles.cycleGroup, animatedStyle]}>
      <View style={styles.groupLabelRow}>
        <ThemedText variant="subtitle" color="mint" style={styles.sectionTitle}>
          {section.title}
        </ThemedText>
        {/* The day sits UNDER the dispatch time, not in front of it.
            Inline as "Tomorrow · Dispatch by 7:30 AM ›" the pair ran the full
            width of the row and left the cycle name looking crowded against
            it — one long line carrying two separate facts. Stacked, the time
            leads and the day qualifies it, which is also the order the
            customer reads them in. */}
        {/* No dispatch time, no link. The plan tab's catch-all group has no
            cycle behind it (see buildPlanSections), so there is nothing for
            the popup to describe and "Dispatch by  ›" would be a broken
            sentence pointing at an empty sheet. */}
        {section.deliveryBy ? (
          <TouchableOpacity
            onPress={() => onOpenPopup(section)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.dispatchBlock}
          >
            <ThemedText variant="small" color="muted" style={styles.dispatchLink}>
              Dispatch by {section.deliveryBy} ›
            </ThemedText>
            {dayLabel ? (
              <ThemedText variant="small" color="mint" style={styles.dispatchDay}>
                {dayLabel}
              </ThemedText>
            ) : null}
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.groupContainer}>
        {children}
      </View>
    </ReAnimated.View>
  );
}

const styles = StyleSheet.create({
  cycleGroup: { marginBottom: Theme.spacing.lg },
  groupLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.xs,
    paddingBottom: Theme.spacing.xs,
  },
  sectionTitle: { fontSize: Theme.typography.sizes.subtitle + 4 },
  /** Right-aligned so the two lines share an edge with each other and with
   *  the rows beneath, rather than each finding its own margin. */
  dispatchBlock: { alignItems: 'flex-end' },
  dispatchLink: { fontSize: Theme.typography.sizes.small + 2 },
  /** Subtext: a step down from the time it qualifies, and it keeps the mint
   *  because WHICH DAY is the part a customer can get wrong. */
  dispatchDay: { fontSize: Theme.typography.sizes.small, marginTop: 1 },
  // No card border — items flow directly on the primary background
  groupContainer: {},
});
