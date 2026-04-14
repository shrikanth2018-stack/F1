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
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { CustomerNavigator } from './CustomerNavigator';
import { StaffNavigator } from './StaffNavigator';
import { AdminNavigator } from './AdminNavigator';
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
  const [step, setStep] = useState<AuthStep>('phone');
  const [pendingPhone, setPendingPhone] = useState('');
  const [pendingName, setPendingName] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
  /** True after new-user OTP verify — show address screen before the app */
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

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
      <NavigationContainer theme={darkTheme}>
        {session.role === 'admin' && <AdminNavigator />}
        {session.role === 'staff' && <StaffNavigator />}
        {session.role === 'customer' && <CustomerNavigator />}
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
      onOTPSent={(phone) => {
        setPendingPhone(phone);
        setStep('otp');
      }}
    />
  );
}
