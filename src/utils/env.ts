/**
 * 1stOne F1 — Environment Variables
 *
 * All env vars must be prefixed with EXPO_PUBLIC_ for client access.
 * Secrets (RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET)
 * are Edge Function only — never exposed to client.
 */

import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};

export const RAZORPAY_KEY_ID =
  process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? extra.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? '';
