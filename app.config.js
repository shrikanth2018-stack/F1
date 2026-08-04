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

/**
 * Sentry source-map upload — added ONLY when it is actually configured.
 *
 * Without it Sentry still receives every crash (the DSN is set in eas.json),
 * but each one points at a minified position like
 * `index.android.bundle:1:428931` instead of a file and line, which is close
 * to unactionable.
 *
 * Conditional rather than hardcoded, deliberately: wrong org/project slugs
 * make the upload step fail during a build, and a release build failing over
 * a telemetry detail is a bad trade. Absent config, this is simply omitted and
 * builds behave exactly as they did before.
 *
 * TO TURN IT ON — the slugs are NOT derivable from the DSN, which carries only
 * numeric ids (org 4511278945533952, project 4511278950514688). Read both from
 * Sentry → Settings, then:
 *
 *   eas secret:create --scope project --name SENTRY_ORG          --value <org-slug>
 *   eas secret:create --scope project --name SENTRY_PROJECT      --value <project-slug>
 *   eas secret:create --scope project --name SENTRY_AUTH_TOKEN   --value <token>
 *
 * SENTRY_AUTH_TOKEN needs the `project:releases` scope. It is a WRITE
 * credential, which is why all three are EAS secrets rather than entries in
 * eas.json — that file is committed.
 *
 * After the first build with these set, open a release in Sentry and confirm a
 * stack trace shows real filenames. The upload step does not fail the build if
 * the token is missing, so the only way to know it worked is to look.
 */
const sentryPlugin =
  process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? [
        [
          '@sentry/react-native/expo',
          {
            organization: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
          },
        ],
      ]
    : [];

export default ({ config }) => {
  const appConfig = {
    ...config,
    name: '1stOne',
    slug: '1stOne-F1',
    version: '1.4.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    // Hermes is the Expo SDK 54 default; declared explicitly so future readers don't have to infer.
    jsEngine: 'hermes',
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
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
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
          icon: './assets/notification-icon.png',
          color: '#38bdf8',
        },
      ],
      'expo-asset',
      [
        'expo-image-picker',
        {
          photosPermission:
            '1stOne needs photo library access to upload menu and product photos.',
        },
      ],
      ...sentryPlugin,
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
