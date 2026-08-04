/**
 * Jest global setup — runs in setupFiles, AFTER jest-expo's preset setup.
 *
 * expo/src/winter/runtime.native.ts installs lazy getters for several globals
 * using a captured require() from the setup-time Runtime instance. Jest sets
 * isInsideTestCode = false on that instance after setup completes. When tests
 * later access these globals, the lazy require() fires on the "dead" instance
 * and throws "outside of scope".
 *
 * Fix: eagerly trigger every lazy getter HERE (while isInsideTestCode is still
 * undefined on the setup instance, which satisfies Jest's !== false check).
 */
'use strict';

// Supabase env, globally.
//
// src/api/supabaseClient.ts calls createClient() at MODULE level, so importing
// anything that transitively reaches it throws "supabaseUrl is required"
// before a single test runs. These are deliberately not real: a test that
// accidentally makes a live call fails against a bogus host instead of
// reaching production.
process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';

// AsyncStorage, globally.
//
// Its native module is null under Jest, and merely IMPORTING it throws. Any
// test that renders a screen reaches it within two or three hops —
// MenuEditorModal -> catalogPhoto -> supabaseClient -> AsyncStorage — so
// without this, every screen test would open with the same block of
// boilerplate before it could test anything.
//
// The package's own mock, not a hand-rolled one, so it keeps up with the
// package. Per-file jest.mock calls still override this where a test wants to
// drive storage itself (useOfflineSync does).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// Safe-area insets, globally.
//
// useSafeAreaInsets throws outside a SafeAreaProvider, and App.tsx mounts that
// provider once at the root — so every screen below it assumes insets exist
// and none of them provide it themselves. Without this each screen test would
// have to wrap in a provider just to render. The library's own mock returns
// zero insets, which is the right answer for a layout nothing asserts on.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default);

// Eagerly resolve every global that runtime.native.ts installs lazily
void globalThis.TextDecoder;
void globalThis.TextDecoderStream;
void globalThis.TextEncoderStream;
void globalThis.URL;
void globalThis.URLSearchParams;
void globalThis.__ExpoImportMetaRegistry;
void globalThis.structuredClone;
