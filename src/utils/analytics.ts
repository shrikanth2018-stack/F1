/**
 * 1stOne F1 — Analytics (PostHog)
 *
 * Tracks key funnel events to answer:
 *   - Which plans convert best?
 *   - Where do users drop off?
 *   - What causes churn?
 *
 * Setup:
 *   1. Create a project at https://app.posthog.com
 *   2. Copy your API key and add to .env:
 *      EXPO_PUBLIC_POSTHOG_KEY=phc_xxxxxxxxxxxx
 *   3. PostHog host defaults to EU cloud (app.posthog.com)
 *      For US cloud use: https://us.i.posthog.com
 *
 * Events are no-ops if EXPO_PUBLIC_POSTHOG_KEY is not set.
 */

import PostHog from 'posthog-react-native';

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

let client: PostHog | null = null;

export function initAnalytics() {
  if (!POSTHOG_KEY) return;
  client = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });
}

export function identifyUser(userId: string, properties?: Record<string, string | number | boolean | null>) {
  client?.identify(userId, properties);
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

export function trackOrderPlaced(orderId: number | string, total: number, paymentMethod: string, cartType: 'food' | 'essentials') {
  client?.capture('order_placed', { order_id: orderId, total, payment_method: paymentMethod, cart_type: cartType });
}

export function trackOrderFailed(reason: string, cartType: 'food' | 'essentials') {
  client?.capture('order_failed', { reason, cart_type: cartType });
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
