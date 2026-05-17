/**
 * 1stOne F1 — usePushNotifications
 *
 * Registers for push notifications via Expo.
 * Stores the push token in Supabase (push_notification_tokens table).
 * Handles foreground notification display.
 * Tapping a notification deep-links to the relevant screen via navigationRef.
 *
 * Notification data payload convention (sent from backend/Edge Function):
 *   { screen: 'OrderDetail', params: { orderId: '...' } }
 *   { screen: 'Subscriptions' }
 *   { screen: 'SubscriptionDetail', params: { subscriptionId: '...' } }
 *   { screen: 'Wallet' }
 *
 * Platform: Firebase FCM (Android), APNs (iOS)
 */

import { useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { navigationRef } from '../navigation/navigationRef';

// Configure foreground notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    // Push notifications don't work on simulators
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // Android needs a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '1stOne Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#38bdf8',
      sound: 'default',
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  return tokenData.data;
}

export function usePushNotifications() {
  const { session } = useAuth();
  const notificationListener = useRef<Notifications.EventSubscription | undefined>(undefined);
  const responseListener = useRef<Notifications.EventSubscription | undefined>(undefined);

  const savePushToken = useCallback(
    async (token: string) => {
      if (!session?.user.id) return;

      // Register THIS device's current token. is_active:true also reactivates
      // a row that an earlier cleanup pass had retired (user returns to a
      // device they'd opened before).
      await supabase.from('push_notification_tokens').upsert(
        {
          user_id: session.user.id,
          token,
          platform: Platform.OS,
          is_active: true,
        },
        { onConflict: 'user_id,token' }
      );

      // Retire this user's OTHER token rows — stale tokens from old installs
      // or builds whose Expo token has since changed. Without this they pile
      // up as is_active=true forever, so one status push fans out to a stack
      // of dead tokens (and a returning device gets the push more than once).
      // One active token per user: the most recently registered device wins.
      await supabase
        .from('push_notification_tokens')
        .update({ is_active: false })
        .eq('user_id', session.user.id)
        .neq('token', token);
    },
    [session?.user.id]
  );

  useEffect(() => {
    if (!session?.user.id) return;

    registerForPushNotifications().then((token) => {
      if (token) savePushToken(token);
    });

    // Listen for notifications received while app is foregrounded
    notificationListener.current =
      Notifications.addNotificationReceivedListener((_notification) => {
        // Could update a badge count or trigger a query refresh here
      });

    // Listen for user tapping on a notification — deep link to relevant screen
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as Record<string, any>;
        const screen = data?.screen as string | undefined;
        const params = data?.params as Record<string, any> | undefined;

        if (screen && navigationRef.isReady()) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (navigationRef as any).navigate(screen, params);
        }
      });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [session?.user.id, savePushToken]);
}
