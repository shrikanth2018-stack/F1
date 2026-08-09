/**
 * 1stOne F1 — Analytics (PostHog)
 *
 * Tracks key funnel events to answer:
 *   - Which plans convert best?
 *   - Where do users drop off?
 *   - What causes churn?
 *
 * Setup:
 *   1. Create a project at https://posthog.com
 *   2. Put its project API key in .env AND in eas.json's production +
 *      preview profiles: EXPO_PUBLIC_POSTHOG_KEY=phc_xxxxxxxxxxxx
 *      (Safe to commit — a PostHog project key is write-only by design and
 *      meant to ship inside client apps. Unlike SENTRY_AUTH_TOKEN, which is
 *      an EAS secret because it can WRITE to your Sentry org.)
 *   3. SET THE HOST TO MATCH THE PROJECT'S REGION. The default below is EU;
 *      a US-cloud project needs EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com.
 *      Point it at the wrong region and events vanish with no error — the
 *      same silent failure Sentry spent months in.
 *   4. Web is separate: set the same variables in Cloudflare Pages, or
 *      app.1stone.in reports nothing while the phones report fine.
 *
 * TWO REASONS THIS STAYS SILENT, both deliberate:
 *   - no key           nothing is configured yet
 *   - a dev build      see below
 */

import PostHog from 'posthog-react-native';

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

let client: PostHog | null = null;

/**
 * OFF IN DEVELOPMENT, matching what sentry.ts already does.
 *
 * Without this, every simulator run and dev-client session lands in the same
 * project as real customers — so the funnel measures whoever is building the
 * app as much as whoever is buying from it, and the pollution is invisible
 * because a dev session looks exactly like a real one.
 *
 * Sentry got this right (`enabled: !__DEV__`) and analytics did not; the only
 * reason it never caused harm is that no key was ever configured.
 */
export function initAnalytics() {
  if (!POSTHOG_KEY) return;
  if (__DEV__) return;
  client = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });
}

/** Whether analytics is actually live, and where it points — for Job Health. */
export function analyticsStatus(): { enabled: boolean; reason: string; host: string } {
  if (!POSTHOG_KEY) {
    return { enabled: false, reason: 'No EXPO_PUBLIC_POSTHOG_KEY in this build', host: POSTHOG_HOST };
  }
  if (__DEV__) {
    return { enabled: false, reason: 'Off in development builds, by design', host: POSTHOG_HOST };
  }
  return { enabled: true, reason: 'Sending events', host: POSTHOG_HOST };
}

/**
 * The user id ONLY — never the phone number.
 *
 * It used to pass `{ phone }`, which exported a customer's personal data to a
 * third-party SaaS for no analytical gain: the UUID already identifies the
 * person for funnels and retention, and "who is this?" is a lookup against our
 * own database, where the number already lives. Extra properties are still
 * accepted for genuinely non-identifying traits.
 */
const CONTACT_KEYS = /^(phone|phone_number|mobile|email|contact|contact_phone|full_name|name|address)$/i;

export function identifyUser(userId: string, properties?: Record<string, string | number | boolean | null>) {
  // Stripped HERE rather than trusted to every call site. The rule was a
  // convention once — "just pass the id" — and the convention lost: useAuth
  // passed `{ phone }` for months. A convention needs everyone who ever
  // writes a call to remember it; this needs nobody to.
  let safe = properties;
  if (properties) {
    safe = {};
    for (const [k, v] of Object.entries(properties)) {
      if (CONTACT_KEYS.test(k)) continue;
      safe[k] = v;
    }
  }
  client?.identify(userId, safe);
}

export function resetAnalyticsUser() {
  client?.reset();
}

// ── Funnel Events ────────────────────────────────────────────

export function trackSignup(method: 'phone_otp') {
  client?.capture('signed_up', { method });
}

export function trackLogin() {
  client?.capture('logged_in');
}

export function trackPlanViewed(planId: number, planName: string, price: number) {
  client?.capture('plan_viewed', { plan_id: planId, plan_name: planName, price });
}

export function trackSubscribed(planId: number, planName: string, paymentMethod: string) {
  client?.capture('subscribed', { plan_id: planId, plan_name: planName, payment_method: paymentMethod });
}

export function trackOrderPlaced(orderId: number | string, total: number, paymentMethod: string) {
  client?.capture('order_placed', { order_id: orderId, total, payment_method: paymentMethod });
}

export function trackOrderFailed(reason: string) {
  client?.capture('order_failed', { reason });
}

export function trackWalletTopUp(amount: number) {
  client?.capture('wallet_top_up', { amount });
}

export function trackReferralApplied(code: string) {
  client?.capture('referral_applied', { code });
}

export function trackReferralShared() {
  client?.capture('referral_shared');
}

export function trackSkipDay(subscriptionId: number) {
  client?.capture('subscription_day_skipped', { subscription_id: subscriptionId });
}

export function trackSubscriptionPaused(subscriptionId: number) {
  client?.capture('subscription_paused', { subscription_id: subscriptionId });
}

export function trackFeedbackSubmitted(rating: number) {
  client?.capture('feedback_submitted', { rating });
}
