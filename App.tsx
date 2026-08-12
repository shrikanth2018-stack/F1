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
import { AppState, Platform, StatusBar, LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';

import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AuthProvider, useAuth } from './src/hooks/useAuth';
import { RootNavigator } from './src/navigation/RootNavigator';
import { OfflineBanner } from './src/components/OfflineBanner';
import { LoadingOverlay } from './src/components/LoadingOverlay';
import { DialogHost } from './src/components/DialogHost';
import { PhotoCropHost } from './src/components/PhotoCropHost';
import { useUIStore } from './src/store/uiStore';
import { useOTAUpdates } from './src/hooks/useOTAUpdates';
import { QUERY_STALE_TIME } from './src/utils/constants';
import { Theme } from './src/theme';
import { initSentry } from './src/utils/sentry';
import { initAnalytics } from './src/utils/analytics';

initSentry();
initAnalytics();

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
      // Refetch stale queries when the app returns to the foreground —
      // paired with the AppState → focusManager wiring below. Without it a
      // staff phone waking from sleep (realtime socket silently dropped)
      // shows a stale board until pull-to-refresh (health report #21).
      // Only queries older than staleTime actually refetch.
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 1,
    },
  },
});

// Tell React Query when the app is foregrounded — on native it has no
// window focus events, so without this refetchOnWindowFocus never fires.
// Web keeps React Query's built-in visibility handling.
function useAppFocusManager() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (status) => {
      focusManager.setFocused(status === 'active');
    });
    return () => sub.remove();
  }, []);
}

function AppContent() {
  const { isLoading } = useAuth();
  useAppFocusManager();
  const isGlobalLoading = useUIStore((s) => s.isGlobalLoading);
  const globalLoadingMessage = useUIStore((s) => s.globalLoadingMessage);

  // OTA: check for + apply published updates without a manual relaunch (D9).
  useOTAUpdates();

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
      <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background.primary} />
      <OfflineBanner />
      <RootNavigator />
      <LoadingOverlay visible={isGlobalLoading} message={globalLoadingMessage} />
      <DialogHost />
      {/* Square-crop dialog for catalogue photos. Renders nothing on native,
          where expo-image-picker already runs the OS cropper. */}
      <PhotoCropHost />
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
