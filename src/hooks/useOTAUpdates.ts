/**
 * 1stOne F1 — useOTAUpdates
 *
 * In-app over-the-air update wiring (audit D9).
 *
 * app.config.js configures expo-updates with checkAutomatically: 'ON_LOAD'
 * and fallbackToCacheTimeout: 0 — so a published update is downloaded on
 * launch but only *applied* on the NEXT launch. A user who never fully
 * closes the app could run a stale bundle indefinitely.
 *
 * This hook closes that gap: on launch and whenever the app returns to the
 * foreground it checks for an update, fetches it, and offers an immediate
 * restart. Prompts at most once per session — decline and the native
 * ON_LOAD path still applies it on the next cold start.
 *
 * No-ops in dev / Expo Go (Updates.isEnabled is false there).
 */

import { useEffect, useRef } from 'react';
import { confirmDialog } from '../utils/confirmDialog';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

export function useOTAUpdates() {
  const prompted = useRef(false);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    let cancelled = false;

    const checkAndPrompt = async () => {
      if (prompted.current) return;
      try {
        const res = await Updates.checkForUpdateAsync();
        if (cancelled || !res.isAvailable) return;

        await Updates.fetchUpdateAsync();
        if (cancelled || prompted.current) return;

        prompted.current = true;
        confirmDialog({
          title: 'Update available',
          message: 'A new version of 1stOne is ready. Restart now to use it?',
          confirmLabel: 'Restart',
          cancelLabel: 'Later',
        }).then((ok) => {
          if (ok) Updates.reloadAsync().catch(() => {});
        });
      } catch {
        // Offline or update server unreachable — ignore; retried next foreground.
      }
    };

    checkAndPrompt();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAndPrompt();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
}
