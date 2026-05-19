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
  children: React.ReactNode;
}

export function CycleGroup({ section, index, onOpenPopup, children }: CycleGroupProps) {
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
        <TouchableOpacity
          onPress={() => onOpenPopup(section)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ThemedText variant="small" color="muted" style={styles.dispatchLink}>
            Dispatch by {section.deliveryBy} ›
          </ThemedText>
        </TouchableOpacity>
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
  dispatchLink: { fontSize: Theme.typography.sizes.small + 2 },
  // No card border — items flow directly on the primary background
  groupContainer: {},
});
