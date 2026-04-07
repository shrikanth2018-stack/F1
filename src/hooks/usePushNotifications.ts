/**
 * 1stOne F1 — usePushNotifications
 *
 * Registers for push notifications via Expo.
 * Stores the push token in Supabase (push_notification_tokens table).
 * Handles foreground notification display.
 *
 * Platform: Firebase FCM (Android), APNs (iOS)
 */

import { useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';

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
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  return tokenData.data;
}

export function usePushNotifications() {
  const { session } = useAuth();
  const notificationListener = useRef<Notifications.EventSubscription>();
  const responseListener = useRef<Notifications.EventSubscription>();

  const savePushToken = useCallback(
    async (token: string) => {
      if (!session?.user.id) return;

      await supabase.from('push_notification_tokens').upsert(
        {
          user_id: session.user.id,
          token,
          platform: Platform.OS,
        },
        { onConflict: 'user_id,token' }
      );
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

    // Listen for user tapping on a notification
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((_response) => {
        // Could navigate to order detail screen here
      });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [session?.user.id, savePushToken]);
}
