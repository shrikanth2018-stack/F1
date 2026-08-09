/**
 * 1stOne F1 — HomeTabStrip
 *
 * Home's top-level switch: Food | Essentials | Subscribe, drawn as browser
 * tabs (the Chrome shape the owner asked for on 2026-08-09).
 *
 * The mechanic that sells a browser tab is not the rounded corners — it is
 * that the ACTIVE tab is the same colour as the page below it and breaks
 * through the line that the inactive tabs sit on, so the tab and the content
 * read as one sheet. Everything here serves that: the strip owns the hairline,
 * the active tab is filled with the screen background and covers the hairline
 * with its own bottom edge, and the inactive tabs are recessed a shade darker.
 *
 * Tabs hold fixed positions, as browser tabs do — a tab is identified by
 * where it sits, so nothing slides to the centre.
 *
 * This is Home-only on purpose. `SegmentedControl` is shared by eight other
 * screens (Orders, Plans, Hub, Vendor, three Admin) and stays as it is.
 */

import React from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';

export interface TabOption<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  options: [TabOption<T>, TabOption<T>, ...TabOption<T>[]];
  value: T;
  onChange: (key: T) => void;
  style?: StyleProp<ViewStyle>;
}

export function HomeTabStrip<T extends string>({ options, value, onChange, style }: Props<T>) {
  // Spring-down entrance, matching SegmentedControl (audit D24).
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
    <ReAnimated.View style={[styles.outer, style, entranceStyle]}>
      {/* Drawn FIRST so the tabs paint over it — the inactive ones clear it by
          a pixel, the active one covers it. Painting order rather than zIndex,
          which is unreliable on Android. */}
      <View style={styles.baseline} pointerEvents="none" />
      {options.map((o) => {
        const active = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            style={[styles.tab, active ? styles.tabActive : styles.tabInactive]}
            activeOpacity={0.8}
            onPress={() => onChange(o.key)}
          >
            <ThemedText
              variant="subtitle"
              /* NOT mint — the cycle section titles below are mint, and an
                 identical colour made the tab read as another section header
                 rather than as the selected tab. */
              color={active ? 'primary' : 'muted'}
              style={active ? styles.labelActive : styles.labelInactive}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {o.label}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </ReAnimated.View>
  );
}

const TAB_H = 40;

const styles = StyleSheet.create({
  outer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: TAB_H,
  },
  /** The line every inactive tab sits on. The active tab covers it. */
  baseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: `${Theme.colors.text.mint}4D`,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  /** Recessed: a shade darker than the page, shorter so the active tab stands
   *  taller, and held a pixel clear of the bottom so the baseline shows
   *  running underneath it. */
  tabInactive: {
    height: TAB_H - 4,
    marginBottom: 1,
    backgroundColor: Theme.colors.background.tertiary,
    marginHorizontal: 1,
  },
  /**
   * Filled with the SCREEN background so the tab and the list below it are one
   * surface, outlined on three sides only, and flush to the bottom so its own
   * fill hides the baseline.
   */
  tabActive: {
    /** Slightly wider than a resting tab — enough to feel picked, not enough
     *  to squeeze the other two labels. */
    flex: 1.15,
    height: TAB_H,
    backgroundColor: Theme.colors.background.primary,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
  },
  labelInactive: { fontSize: Theme.typography.sizes.body },
  labelActive: { fontSize: Theme.typography.sizes.body + 2 },
});
