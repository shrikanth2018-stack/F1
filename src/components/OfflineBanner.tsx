/**
 * 1stOne F1 — OfflineBanner
 * Root-mounted banner that appears when device loses network.
 * Uses @react-native-community/netinfo for connectivity detection.
 *
 * ALWAYS MOUNTED, moved out of view rather than unmounted. It used to
 * `return null` when online, which caused two problems:
 *
 *   1. The slide-away animation never played. Going back online set isOffline
 *      false, React removed the view immediately, and the 300ms timing ran
 *      against nothing — the banner vanished instead of sliding out.
 *   2. `WARN Sending onAnimatedValueUpdate with no listeners registered`, once
 *      per frame of that animation: a native-driven Animated.Value whose view
 *      is not mounted has nowhere to send its updates. NetInfo fires several
 *      times during startup, so it arrived in bursts.
 *
 * Keeping it mounted fixes both. Parked, it sits fully above the top edge and
 * is made non-interactive, so it cannot swallow taps meant for the header
 * beneath it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Animated } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

/**
 * How far up to park it. Comfortably taller than the banner itself (one line
 * plus spacing.xs top and bottom) so no sliver shows at a large font scale —
 * the old -50 was close enough to the real height to be a gamble.
 */
const HIDDEN_Y = -120;

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  // useRef, not useState: the value is mutated by the animation driver, not
  // by React, and re-creating it on a re-render would strand the running one.
  const slideAnim = useRef(new Animated.Value(HIDDEN_Y)).current;

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);
      setIsOffline(offline);
      Animated.timing(slideAnim, {
        toValue: offline ? 0 : HIDDEN_Y,
        duration: 300,
        useNativeDriver: true,
      }).start();
    });

    return () => unsubscribe();
  }, [slideAnim]);

  return (
    <Animated.View
      style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}
      // Parked off-screen it must not intercept anything, and a screen reader
      // should not announce a banner nobody can see.
      pointerEvents={isOffline ? 'auto' : 'none'}
      accessibilityElementsHidden={!isOffline}
      importantForAccessibility={isOffline ? 'auto' : 'no-hide-descendants'}
    >
      <ThemedText variant="small" color="primary">
        No internet connection
      </ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: Theme.colors.status.error,
    paddingVertical: Theme.spacing.xs,
    alignItems: 'center',
    zIndex: 9999,
  },
});
