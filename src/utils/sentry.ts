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

/**
 * Fire one deliberate event, to prove crash reporting actually works.
 *
 * WHY THIS EXISTS. Sentry can look perfectly configured and report nothing —
 * it did here for months, pointed at a project that did not exist. Even once
 * the DSN was right, "is it working?" stayed unanswerable, because the only
 * way an error reaches Sentry is for something to genuinely go wrong, and a
 * healthy app supplies no material.
 *
 * There are TWO separate questions and this answers both at once:
 *   1. does an event arrive at all
 *   2. does its stack trace name a real file and line, or does it read
 *      `index.android.bundle:1:428931` — which happens whenever the
 *      source-map upload silently failed, and that upload does NOT fail a
 *      build when it breaks
 *
 * It must be asked again after EVERY native build, because a new binary can
 * ship without its maps and nothing will say so.
 *
 * Returns false when Sentry is inert — no DSN, or a dev build, where
 * `enabled: !__DEV__` means nothing is transmitted. Saying so is the point:
 * a silent no-op here would look exactly like a delivery failure.
 */
export function sendSentryTestEvent(context?: Record<string, unknown>): boolean {
  if (!SENTRY_DSN) return false;
  if (__DEV__) return false;

  Sentry.withScope((scope) => {
    // Tagged so it can be filtered out of real incidents, and found again.
    scope.setTag('diagnostic', 'true');
    scope.setLevel('info');
    if (context) scope.setExtras(context);
    Sentry.captureException(new Error('1stOne diagnostic — crash reporting is alive'));
  });
  return true;
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
