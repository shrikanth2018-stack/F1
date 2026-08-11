/**
 * 1stOne F1 — "go and look at the plans"
 *
 * There used to be two places to browse plans: the Subscribe tab on Home, and
 * a separate `Plans` screen reached from My Orders and My Subscriptions. Two
 * lists of the same rows, and only the tab got the cycle grouping, the
 * pictures and the plan builder — so the older route quietly became the worse
 * one. This sends every entry point to the tab, and `PlansScreen` is gone.
 *
 * The tab is state, not a route, so getting there is two steps: set the tab
 * BEFORE navigating, so Home renders on the right one rather than showing
 * Food for a frame and switching under the customer's eyes.
 *
 * `navigate` rather than `push`: Home is the stack root and already mounted,
 * so this pops back to it instead of stacking a second copy behind the first.
 */

import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useUIStore } from '../store/uiStore';
import type { CustomerNavProp } from '../navigation/types';

export function useBrowsePlans(): () => void {
  const navigation = useNavigation<CustomerNavProp>();
  const setActiveHomeTab = useUIStore((s) => s.setActiveHomeTab);

  return useCallback(() => {
    setActiveHomeTab('subscription');
    navigation.navigate('Home');
  }, [navigation, setActiveHomeTab]);
}
