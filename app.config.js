/**
 * 1stOne F1 — Dynamic Expo Config
 *
 * Replaces static app.json. Reads env vars at build time
 * so secrets never leak into the JS bundle.
 *
 * react-native-maps has no Expo config plugin — Google Maps API key is
 * injected into AndroidManifest.xml via the inline withGoogleMapsAndroid plugin.
 */

const { withAndroidManifest } = require('@expo/config-plugins');

/** Injects the Google Maps API key meta-data into AndroidManifest.xml. */
const withGoogleMapsAndroid = (config) => {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application[0];
    if (!application['meta-data']) application['meta-data'] = [];
    // Remove any existing entry to avoid duplicates on re-prebuild
    application['meta-data'] = application['meta-data'].filter(
      (item) => item.$['android:name'] !== 'com.google.android.geo.API_KEY'
    );
    application['meta-data'].push({
      $: {
        'android:name': 'com.google.android.geo.API_KEY',
        'android:value': process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '',
      },
    });
    return cfg;
  });
};

export default ({ config }) => {
  const appConfig = {
    ...config,
    name: '1stOne',
    slug: '1stOne-F1',
    version: '1.1.0',
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
          '1stOne needs your location to verify your delivery address and record attendance.',
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
      'expo-updates',
      'expo-splash-screen',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            '1stOne needs your location to verify your delivery address and record attendance.',
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
      withGoogleMapsAndroid,
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
      // Default is ON_LOAD but make it explicit so future SDK upgrades don't change behavior.
      checkAutomatically: 'ON_LOAD',
      // Apply downloaded updates on the next launch immediately (no cache stalling).
      fallbackToCacheTimeout: 0,
    },
    runtimeVersion: {
      policy: 'sdkVersion',
    },
  };

  return appConfig;
};
