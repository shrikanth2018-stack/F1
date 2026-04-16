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

if (Platform.OS !== 'web') {
  require('react-native-url-polyfill/auto');
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
