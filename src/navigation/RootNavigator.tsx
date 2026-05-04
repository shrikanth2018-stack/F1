/**
 * 1stOne F1 — Root Navigator (BF-18)
 *
 * Auth state machine (post-BF-18 consolidation):
 *   'login'   → LoginScreen (unified phone + OTP entry; emits onExistingUser
 *               or onNewUser(phone) on successful verify)
 *   'name'    → OnboardingScreen (new user: combined name + address +
 *               location capture, atomic save)
 *
 * After session is live:
 *   step === 'name' → OnboardingScreen (atomic name + address save in one tx)
 *   otherwise       → role-based navigator (admin / staff / customer)
 *
 * The previous separate 'otp' step + OTPScreen have been folded into
 * LoginScreen as an internal phase machine (see BF-18). RootNavigator
 * no longer routes the phone string between auth screens — LoginScreen
 * owns its own phone+OTP state and passes the verified phone via
 * onNewUser(phone).
 */

import React, { useState, useEffect, useRef } from 'react';
import { Linking, Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { useApplyReferralCode } from '../hooks/useReferrals';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { navigationRef } from './navigationRef';
import { CustomerNavigator } from './CustomerNavigator';
import { StaffNavigator } from './StaffNavigator';
import { AdminNavigator } from './AdminNavigator';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { OnboardingScreen } from '../screens/auth/OnboardingScreen';
import { Theme } from '../theme';

type AuthStep = 'login' | 'name';

const darkTheme = {
  dark: true,
  colors: {
    primary: Theme.colors.action.primary,
    background: Theme.colors.background.primary,
    card: Theme.colors.background.secondary,
    text: Theme.colors.text.primary,
    border: Theme.colors.layout.divider,
    notification: Theme.colors.status.error,
  },
  fonts: {
    regular: { fontFamily: Theme.typography.fontFamily, fontWeight: 'normal' as const },
    medium: { fontFamily: Theme.typography.fontFamily, fontWeight: 'normal' as const },
    bold: { fontFamily: Theme.typography.fontFamily, fontWeight: 'normal' as const },
    heavy: { fontFamily: Theme.typography.fontFamily, fontWeight: 'normal' as const },
  },
};

export function RootNavigator() {
  const { session, isLoading, signOut } = useAuth();
  // Register push token when signed in; no-ops when session is null
  usePushNotifications();
  const [step, setStep] = useState<AuthStep>('login');
  const [pendingPhone, setPendingPhone] = useState('');
  /** Referral code carried in from a deep link (1stone://referral?code=XXX) */
  const [pendingReferralCode, setPendingReferralCode] = useState<string | null>(null);
  /** Ensures auto-apply fires once per pending code, not on every session refresh */
  const referralAppliedRef = useRef<string | null>(null);
  const applyReferral = useApplyReferralCode();

  // Handle incoming deep links (cold start + foreground)
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        if (parsed.hostname === 'referral') {
          const code = parsed.searchParams.get('code');
          if (code) setPendingReferralCode(code);
        }
      } catch {}
    };

    // Cold-start URL
    Linking.getInitialURL().then(handleUrl);

    // Foreground URL
    const sub = Linking.addEventListener('url', (e) => handleUrl(e.url));
    return () => sub.remove();
  }, []);

  // Reset auth flow state whenever session is cleared (logout)
  useEffect(() => {
    if (!session && !isLoading) {
      setStep('login');
      setPendingPhone('');
      referralAppliedRef.current = null;
    }
  }, [session, isLoading]);

  // Auto-apply referral code once the session is live. Fires once per code —
  // the edge function is idempotent (returns "already used" for repeats), so
  // on any terminal outcome we clear the pending code and mark it applied.
  useEffect(() => {
    if (!session || !pendingReferralCode) return;
    if (referralAppliedRef.current === pendingReferralCode) return;
    referralAppliedRef.current = pendingReferralCode;
    applyReferral.mutate(pendingReferralCode, {
      onSuccess: () => Alert.alert('Referral Applied', 'Your referral reward has been credited.'),
      onError: (err) => Alert.alert('Referral Code', err.message || 'Could not apply referral code.'),
      onSettled: () => setPendingReferralCode(null),
    });
  }, [session, pendingReferralCode, applyReferral]);

  if (isLoading) return null;

  // Registration steps — checked BEFORE session guard to prevent race condition
  // where onAuthStateChange sets session before onNewUser() sets step='name'.
  if (step === 'name') {
    return (
      <OnboardingScreen
        phone={pendingPhone}
        onComplete={() => {
          // Atomic save already wrote profile + first address.
          // Clear the step; the session-driven render below takes over.
          //
          // setStep('login') is a sentinel — 'login' is the default
          // state for "show LoginScreen if no session." Session is
          // live by this point, so the `if (session)` branch further
          // down wins and renders the role navigator. The 'login'
          // value is never observed visually.
          setStep('login');
        }}
        // Session is already live here — the only safe back is to sign out and restart.
        onBack={() => signOut()}
      />
    );
  }

  // Signed in — go to role navigator.
  // Driver-staff (staff role + delivery_hubs/zones.driver_user_id set) is routed
  // through CustomerNavigator with the "My Deliveries" link in ProfilePopup.
  // They retain role='staff' so RLS still grants order read/write.
  if (session) {
    const isDriverStaff = session.role === 'staff' && session.isDriver;
    return (
      <NavigationContainer ref={navigationRef} theme={darkTheme}>
        <ErrorBoundary>
          {session.role === 'admin' && <AdminNavigator />}
          {session.role === 'staff' && !isDriverStaff && <StaffNavigator />}
          {(isDriverStaff || session.role === 'customer' || !['admin', 'staff'].includes(session.role)) && <CustomerNavigator />}
        </ErrorBoundary>
      </NavigationContainer>
    );
  }

  // --- Not signed in: auth flow ---
  // BF-18: LoginScreen owns the entire phone+OTP entry as one screen with
  // an internal phase machine. RootNavigator only sees the verify outcome.
  return (
    <LoginScreen
      referralCode={pendingReferralCode ?? undefined}
      onExistingUser={() => {
        // session already set — onAuthStateChange triggers re-render to role navigator
      }}
      onNewUser={(phone) => {
        setPendingPhone(phone);
        setStep('name');
      }}
    />
  );
}
