/**
 * 1stOne F1 — Root Navigator
 *
 * Auth state machine:
 *   'phone'   → LoginScreen (checks DB: known vs new)
 *   'name'    → RegistrationScreen (new user: collects name, sends OTP)
 *   'otp'     → OTPScreen (verifies; new users get profile created)
 *   'address' → AddAddressScreen (new users only, onboarding step)
 *
 * After session is live:
 *   needsOnboarding=true → show address collection before the app
 *   needsOnboarding=false → role-based navigator
 */

import React, { useState, useEffect } from 'react';
import { Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { navigationRef } from './navigationRef';
import { CustomerNavigator } from './CustomerNavigator';
import { StaffNavigator } from './StaffNavigator';
import { AdminNavigator } from './AdminNavigator';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegistrationScreen } from '../screens/auth/RegistrationScreen';
import { OTPScreen } from '../screens/auth/OTPScreen';
import { AddAddressScreen } from '../screens/customer/AddAddressScreen';
import { Theme } from '../theme';

type AuthStep = 'phone' | 'otp' | 'name';

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
  const { session, isLoading } = useAuth();
  // Register push token when signed in; no-ops when session is null
  usePushNotifications();
  const [step, setStep] = useState<AuthStep>('phone');
  const [pendingPhone, setPendingPhone] = useState('');
  const [pendingName, setPendingName] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
  /** True after new-user OTP verify — show address screen before the app */
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  /** Referral code carried in from a deep link (1stone://referral?code=XXX) */
  const [pendingReferralCode, setPendingReferralCode] = useState<string | null>(null);

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
      setStep('phone');
      setPendingPhone('');
      setPendingName('');
      setIsNewUser(false);
      setNeedsOnboarding(false);
    }
  }, [session, isLoading]);

  if (isLoading) return null;

  // Signed in — but new user still needs to add their first address
  if (session && needsOnboarding) {
    return (
      <AddAddressScreen onComplete={() => setNeedsOnboarding(false)} />
    );
  }

  // Signed in — go to role navigator
  if (session) {
    return (
      <NavigationContainer ref={navigationRef} theme={darkTheme}>
        <ErrorBoundary>
          {session.role === 'admin' && <AdminNavigator />}
          {session.role === 'staff' && <StaffNavigator />}
          {(session.role === 'customer' || !['admin', 'staff'].includes(session.role)) && <CustomerNavigator />}
        </ErrorBoundary>
      </NavigationContainer>
    );
  }

  // --- Not signed in: auth flow ---

  if (step === 'otp') {
    return (
      <OTPScreen
        phone={pendingPhone}
        onBack={() => setStep('phone')}
        onExistingUser={() => {
          // session already set — onAuthStateChange will trigger re-render to role navigator
        }}
        onNewUser={() => {
          setIsNewUser(true);
          setStep('name');
        }}
      />
    );
  }

  if (step === 'name') {
    return (
      <RegistrationScreen
        phone={pendingPhone}
        onComplete={(name) => {
          setPendingName(name);
          setNeedsOnboarding(true);
          // session already live at this point
        }}
        onBack={() => setStep('otp')}
      />
    );
  }

  // Default: phone step
  return (
    <LoginScreen
      referralCode={pendingReferralCode ?? undefined}
      onOTPSent={(phone) => {
        setPendingPhone(phone);
        setStep('otp');
      }}
    />
  );
}
