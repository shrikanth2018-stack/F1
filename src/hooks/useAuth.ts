/**
 * 1stOne F1 — Auth Context & Hook
 *
 * Zero-flash auth flow:
 * 1. SplashScreen held until session check completes
 * 2. Role extracted from JWT custom claim (zero extra queries)
 * 3. onAuthStateChange keeps session alive silently
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../api/supabaseClient';
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

    return {
      user: {
        id: session.user.id,
        phone: session.user.phone || '',
      },
      role,
      assignedHubId,
      branchId,
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
    };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initial session check (reads JWT from AsyncStorage)
    supabase.auth.getSession()
      .then(({ data: { session: existingSession } }) => {
        setSession(extractRole(existingSession));
      })
      .catch(() => {
        setSession(null);
      })
      .finally(() => {
        setIsLoading(false);
      });

    // Listen for auth state changes (token refresh, sign out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(extractRole(newSession));
      }
    );

    return () => subscription.unsubscribe();
  }, []);

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
    await supabase.auth.signOut();
    setSession(null);
  }, []);

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
