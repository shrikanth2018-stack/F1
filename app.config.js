/**
 * 1stOne F1 — Dynamic Expo Config
 *
 * Replaces static app.json. Reads env vars at build time
 * so secrets never leak into the JS bundle.
 */

export default ({ config }) => ({
  ...config,
  name: '1stOne',
  slug: '1stOne-F1',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#151515',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.1stone.f1',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        '1stOne needs your location to record attendance check-in.',
      NSCameraUsageDescription:
        '1stOne needs camera access for profile photos.',
      NSPhotoLibraryUsageDescription:
        '1stOne needs photo library access to upload offer banners.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#151515',
    },
    package: 'com.stone1st.f1',
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'CAMERA',
      'RECEIVE_BOOT_COMPLETED',
      'VIBRATE',
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-splash-screen',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          '1stOne needs your location to record attendance.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/icon.png',
        color: '#38bdf8',
      },
    ],
    'expo-asset',
    [
      'expo-image-picker',
      {
        photosPermission: '1stOne needs photo library access to upload offer banners.',
      },
    ],
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    razorpayKeyId: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID,
    eas: {
      projectId: '81ff7f3c-8f25-4acc-9a4f-605bff80bdd2',
    },
  },
  updates: {
    url: 'https://u.expo.dev/81ff7f3c-8f25-4acc-9a4f-605bff80bdd2',
  },
  runtimeVersion: {
    policy: 'sdkVersion',
  },
});
