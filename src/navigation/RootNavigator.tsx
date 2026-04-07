/**
 * 1stOne F1 — Root Navigator
 *
 * Role-based routing:
 * 1. isLoading → null (SplashScreen held by App.tsx)
 * 2. No session → Auth flow (Login → OTP)
 * 3. role === 'customer' → CustomerNavigator
 * 4. role === 'staff' → StaffNavigator
 * 5. role === 'admin' → AdminNavigator
 *
 * Zero extra queries: role comes from JWT custom claim.
 */

import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { CustomerNavigator } from './CustomerNavigator';
import { StaffNavigator } from './StaffNavigator';
import { AdminNavigator } from './AdminNavigator';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { OTPScreen } from '../screens/auth/OTPScreen';
import { Theme } from '../theme';

const darkTheme = {
  dark: true,
  colors: {
    primary: Theme.colors.action.primary,
    background: Theme.colors.background.primary,
    card: Theme.colors.background.card,
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
  const [otpPhone, setOtpPhone] = useState<string | null>(null);

  // Splash screen is held while loading — don't render anything
  if (isLoading) return null;

  // Not signed in → auth flow
  if (!session) {
    if (otpPhone) {
      return (
        <OTPScreen phone={otpPhone} onBack={() => setOtpPhone(null)} />
      );
    }
    return <LoginScreen onOTPSent={setOtpPhone} />;
  }

  // Signed in → role-based navigator
  return (
    <NavigationContainer theme={darkTheme}>
      {session.role === 'admin' && <AdminNavigator />}
      {session.role === 'staff' && <StaffNavigator />}
      {session.role === 'customer' && <CustomerNavigator />}
    </NavigationContainer>
  );
}
