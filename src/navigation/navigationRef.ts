/**
 * 1stOne F1 — Navigation Ref
 *
 * A shared ref passed to NavigationContainer so that code outside React
 * components (hooks, utils) can trigger navigation without prop drilling.
 *
 * Usage:
 *   import { navigationRef } from './navigationRef';
 *   navigationRef.current?.navigate('OrderDetail', { orderId: '123' });
 */

import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();
