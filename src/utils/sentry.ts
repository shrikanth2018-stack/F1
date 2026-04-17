/**
 * 1stOne F1 — Sentry Initialisation
 *
 * Call initSentry() once at app startup (App.tsx / app entry).
 * DSN is read from EXPO_PUBLIC_SENTRY_DSN environment variable.
 *
 * To get your DSN:
 *   1. Create a project at https://sentry.io
 *   2. Choose React Native
 *   3. Copy the DSN and add to .env:
 *      EXPO_PUBLIC_SENTRY_DSN=https://xxx@oXXX.ingest.sentry.io/YYY
 */

import * as Sentry from '@sentry/react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

export function initSentry() {
  if (!SENTRY_DSN) {
    // DSN not configured yet — Sentry is a no-op until .env is updated
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    // Capture 100% of transactions in dev, 20% in production
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    // Attach user context on every event (set via setSentryUser after login)
    enabled: !__DEV__, // disable in dev to avoid noise; flip to true to test
    environment: __DEV__ ? 'development' : 'production',
  });
}

/** Call after successful login to attach user context to future events */
export function setSentryUser(userId: string, phone?: string) {
  if (!SENTRY_DSN) return;
  Sentry.setUser({ id: userId, username: phone });
}

/** Call on logout */
export function clearSentryUser() {
  if (!SENTRY_DSN) return;
  Sentry.setUser(null);
}

/** Manually capture an unexpected error with extra context */
export function captureError(error: Error, context?: Record<string, unknown>) {
  if (!SENTRY_DSN) {
    console.error('[captureError]', error.message, context);
    return;
  }
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(error);
  });
}
