/**
 * 1stOne F1 — Auth Context & Hook
 *
 * Zero-flash auth flow:
 * 1. SplashScreen held until session check completes
 * 2. Role extracted from JWT custom claim (zero extra queries)
 * 3. onAuthStateChange keeps session alive silently
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from '../api/supabaseClient';
import { useCartStore } from '../store/cartStore';
import { useEssentialsCartStore } from '../store/essentialsCartStore';
import { useStaffQueueStore } from '../store/staffQueueStore';
import { setSentryUser, clearSentryUser } from '../utils/sentry';
import type { UserRole, AuthSession } from '../types';
import type { Session } from '@supabase/supabase-js';

interface AuthContextType {
  session: AuthSession | null;
  isLoading: boolean;
  signInWithPhone: (phone: string) => Promise<{ error: Error | null }>;
  verifyOTP: (phone: string, token: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function extractRole(session: Session | null): AuthSession | null {
  if (!session?.user) return null;

  // Extract role from JWT custom claim (set by custom_access_token_hook)
  const jwt = session.access_token;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    if (__DEV__) {
      console.log('[JWT]', JSON.stringify(payload, null, 2));
    }
    const role: UserRole = payload.user_role || 'customer';
    const assignedHubId: number | null = payload.assigned_hub_id ?? null;
    const branchId: number | null = payload.branch_id ?? null;
    // FT-05: read explicit super-admin claim. Stale JWTs (issued
    // before the FT-05 hook update) won't have it — value falls to
    // false; user signs out + back in once to pick it up. RLS SQL
    // function falls back to the column directly so server-side
    // gating doesn't break in that window.
    const isSuperAdmin: boolean = payload.is_super_admin === true;
    const isDriver: boolean = payload.is_driver === true;

    return {
      user: {
        id: session.user.id,
        phone: session.user.phone || '',
      },
      role,
      assignedHubId,
      branchId,
      isSuperAdmin,
      isDriver,
    };
  } catch {
    return {
      user: {
        id: session.user.id,
        phone: session.user.phone || '',
      },
      role: 'customer',
      assignedHubId: null,
      branchId: null,
      isSuperAdmin: false,
      isDriver: false,
    };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initial session check (reads JWT from AsyncStorage). Also attach
    // the token to the Realtime client up-front so a channel subscribed
    // in the same render pass as a restored session doesn't race the
    // onAuthStateChange listener below.
    supabase.auth.getSession()
      .then(({ data: { session: existingSession } }) => {
        setSession(extractRole(existingSession));
        supabase.realtime.setAuth(existingSession?.access_token ?? null);
      })
      .catch(() => {
        setSession(null);
      })
      .finally(() => {
        setIsLoading(false);
      });

    // Listen for auth state changes (token refresh, sign out).
    // Also keep the Realtime client's auth in lockstep — without this, any
    // channel subscribed shortly after sign-in (e.g. useRealtimeOrders on
    // StaffDashboard) joins as anon, gets rejected by RLS, and triggers
    // supabase-js's auto-reconnect into a tight CLOSED/subscribe loop in
    // React Native. Setting auth here, once, covers every current and
    // future Realtime subscriber.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(extractRole(newSession));
        supabase.realtime.setAuth(newSession?.access_token ?? null);
      }
    );

    // Proactively refresh JWT when app returns to foreground.
    // Beyond preventing 401s after long idle, this picks up server-side claim
    // changes — e.g. a customer promoted to driver via admin assignment will
    // see "My Deliveries" without manual logout. Failures are tolerated; the
    // existing session is preserved so a transient network blip doesn't sign
    // the user out.
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        supabase.auth.refreshSession().then(({ data: { session: refreshed }, error }) => {
          if (!error && refreshed) setSession(extractRole(refreshed));
        });
      }
    };
    const appStateSub = AppState.addEventListener('change', handleAppState);

    return () => {
      subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []);

  // Keep Sentry user context in sync with the session — tags every event
  // (errors, breadcrumbs) with the active user so we can trace incidents.
  useEffect(() => {
    if (session?.user.id) {
      setSentryUser(session.user.id, session.user.phone);
    } else {
      clearSentryUser();
    }
  }, [session?.user.id, session?.user.phone]);

  const signInWithPhone = useCallback(async (phone: string) => {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    return { error: error ? new Error(error.message) : null };
  }, []);

  const verifyOTP = useCallback(async (phone: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });
    return { error: error ? new Error(error.message) : null };
  }, []);

  const signOut = useCallback(async () => {
    // Best-effort: delete this device's push token row so the previous user
    // doesn't keep receiving pushes after logout (shared-device case).
    if (session?.user.id && Device.isDevice) {
      // Race the cleanup against a 3s timeout — a slow/dead network must not
      // block the user from signing out.
      try {
        await Promise.race([
          (async () => {
            const projectId = Constants.expoConfig?.extra?.eas?.projectId;
            const tokenData = await Notifications.getExpoPushTokenAsync(
              projectId ? { projectId } : undefined,
            );
            if (tokenData.data) {
              await supabase
                .from('push_notification_tokens')
                .delete()
                .eq('user_id', session.user.id)
                .eq('token', tokenData.data);
            }
          })(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('push-token cleanup timed out')), 3000),
          ),
        ]);
      } catch (e) {
        console.warn('[useAuth] push token cleanup failed or timed out:', e);
      }
    }

    await supabase.auth.signOut();
    useCartStore.getState().clearCart();
    useEssentialsCartStore.getState().clearCart();
    useStaffQueueStore.getState().clearQueue();
    setSession(null);
  }, [session?.user.id]);

  const value = { session, isLoading, signInWithPhone, verifyOTP, signOut };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
