/**
 * 1stOne F1 — Single Supabase Client Instance
 * Every Supabase interaction in the app goes through this one client.
 *
 * URL polyfill: only applied on native — browsers have a native URL API
 * and the polyfill overwrites it, silently breaking fetch on web.
 * Storage: AsyncStorage on native (persists to device), localStorage on web.
 */

import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Database } from '@/types/database.types';

if (Platform.OS !== 'web') {
  require('react-native-url-polyfill/auto');
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Health report #10: no request may hang forever — a dead connection used to
// leave e.g. the checkout Pay call spinning indefinitely. 60s bound: generous
// enough for image uploads on slow networks, finite for everything.
// A caller-supplied signal always wins (AbortSignal.timeout is not reliable
// on Hermes, so this uses the manual controller pattern).
const REQUEST_TIMEOUT_MS = 60_000;
const fetchWithTimeout: typeof fetch = (input, init) => {
  if (init?.signal) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: fetchWithTimeout,
  },
});
