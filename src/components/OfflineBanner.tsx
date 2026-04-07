/**
 * 1stOne F1 — OfflineBanner
 * Root-mounted banner that appears when device loses network.
 * Uses @react-native-community/netinfo for connectivity detection.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [slideAnim] = useState(new Animated.Value(-50));

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);
      setIsOffline(offline);
      Animated.timing(slideAnim, {
        toValue: offline ? 0 : -50,
        duration: 300,
        useNativeDriver: true,
      }).start();
    });

    return () => unsubscribe();
  }, [slideAnim]);

  if (!isOffline) return null;

  return (
    <Animated.View
      style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}
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
