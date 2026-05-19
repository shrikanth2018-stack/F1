/**
 * 1stOne F1 — SegmentedControl
 *
 * One shared 2-tab "glass pill" with an animated sliding indicator and a
 * spring entrance (audit D24). Replaces the per-screen toggle UIs — the
 * Home/Plans inline glass pill and the plain pills on Orders / Hub — so
 * every 2-tab switch in the app looks and behaves identically.
 *
 * Self-measuring: the indicator width is derived from the rendered width,
 * so the control simply fills whatever the parent gives it. Pass `style`
 * for layout spacing (margins etc.).
 */

import React, { useState } from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  options: [SegmentOption<T>, SegmentOption<T>];
  value: T;
  onChange: (key: T) => void;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({ options, value, onChange, style }: Props<T>) {
  const [width, setWidth] = useState(0);
  const tabWidth = width / 2;
  const activeIndex = options[0].key === value ? 0 : 1;

  // Sliding indicator.
  const pos = useSharedValue(activeIndex);
  React.useEffect(() => {
    pos.value = withSpring(activeIndex, { damping: 20, stiffness: 280, mass: 0.7 });
  }, [activeIndex, pos]);
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pos.value * tabWidth }],
  }));

  // Spring-down entrance.
  const entryY = useSharedValue(-22);
  const entryOpacity = useSharedValue(0);
  React.useEffect(() => {
    entryY.value = withSpring(0, { damping: 16, stiffness: 220, mass: 0.6 });
    entryOpacity.value = withTiming(1, { duration: 380 });
  }, [entryY, entryOpacity]);
  const entranceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: entryY.value }],
    opacity: entryOpacity.value,
  }));

  return (
    <ReAnimated.View
      style={[styles.outer, style, entranceStyle]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 && (
        <ReAnimated.View style={[styles.indicator, { width: tabWidth }, indicatorStyle]} />
      )}
      {options.map((o) => {
        const active = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            style={styles.tab}
            activeOpacity={0.7}
            onPress={() => onChange(o.key)}
          >
            <ThemedText
              variant="subtitle"
              color={active ? 'primary' : 'muted'}
              style={active ? styles.tabActive : styles.tabInactive}
            >
              {o.label}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </ReAnimated.View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flexDirection: 'row',
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: `${Theme.colors.text.mint}22`,
    borderRadius: 20,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  tabInactive: { fontSize: Theme.typography.sizes.subtitle + 2 },
  tabActive: { fontSize: Theme.typography.sizes.subtitle + 4 },
});
