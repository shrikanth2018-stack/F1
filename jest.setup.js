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

// Eagerly resolve every global that runtime.native.ts installs lazily
void globalThis.TextDecoder;
void globalThis.TextDecoderStream;
void globalThis.TextEncoderStream;
void globalThis.URL;
void globalThis.URLSearchParams;
void globalThis.__ExpoImportMetaRegistry;
void globalThis.structuredClone;
