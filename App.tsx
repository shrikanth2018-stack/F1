/**
 * 1stOne F1 — App Entry Point
 *
 * Provider stack (outermost → innermost):
 * 1. ErrorBoundary (JS crash recovery)
 * 2. QueryClientProvider (TanStack Query — server state)
 * 3. AuthProvider (React Context — session + role)
 * 4. SafeAreaProvider
 * 5. StatusBar (light content, dark bg)
 * 6. OfflineBanner (absolute-positioned, root-mounted)
 * 7. LoadingOverlay (global, driven by UIStore)
 * 8. RootNavigator (role-based routing)
 *
 * SplashScreen is held until auth session check completes.
 */

import React, { useEffect } from 'react';
import { StatusBar, LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';

import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AuthProvider, useAuth } from './src/hooks/useAuth';
import { RootNavigator } from './src/navigation/RootNavigator';
import { OfflineBanner } from './src/components/OfflineBanner';
import { LoadingOverlay } from './src/components/LoadingOverlay';
import { useUIStore } from './src/store/uiStore';
import { QUERY_STALE_TIME } from './src/utils/constants';
import { initSentry } from './src/utils/sentry';

initSentry();

// Suppress known harmless warnings in dev
LogBox.ignoreLogs([
  'Setting a timer',
  'AsyncStorage has been extracted',
]);

// Hold splash until auth session check completes
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME,
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

function AppContent() {
  const { isLoading } = useAuth();
  const isGlobalLoading = useUIStore((s) => s.isGlobalLoading);
  const globalLoadingMessage = useUIStore((s) => s.globalLoadingMessage);

  // Hide splash once auth resolves, or after a 5s watchdog so users never
  // see a frozen splash if getSession() hangs (network stalls, etc.).
  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync().catch(() => {});
      return;
    }
    const watchdog = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 5000);
    return () => clearTimeout(watchdog);
  }, [isLoading]);

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#151515" />
      <OfflineBanner />
      <RootNavigator />
      <LoadingOverlay visible={isGlobalLoading} message={globalLoadingMessage} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SafeAreaProvider>
            <AppContent />
          </SafeAreaProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
