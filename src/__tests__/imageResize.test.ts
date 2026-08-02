/**
 * 1stOne F1 — resizeForUpload safety guarantee
 *
 * `resizeForUpload` is platform-split: the web build downscales through a
 * canvas (the picker ignores `quality` there), native is a pass-through until
 * expo-image-manipulator can be added on a native build.
 *
 * Neither variant can be exercised meaningfully under `testEnvironment: node`
 * — there is no canvas, so the web build takes its `typeof document ===
 * 'undefined'` guard and returns the input, exactly as native does. What CAN
 * be pinned, and is the property that actually matters, is that the function
 * never throws and never returns something unusable: a resize is an
 * optimisation, and a failed one must degrade to uploading the original
 * rather than blocking an admin from setting a photo at all.
 */

import { resizeForUpload } from '@/utils/imageResize';

/**
 * Make the native module unavailable, exactly as it is on a phone whose store
 * build predates it.
 *
 * This is not a contrived case. JS ships over the air and native modules do
 * not, so an `eas update` reaches binaries without expo-image-manipulator —
 * and a top-level import there throws during module evaluation, before any
 * try/catch runs, and the app never starts. Requiring it inside the try is
 * what makes every assertion below still hold in that situation.
 */
jest.mock('expo-image-manipulator', () => {
  throw new Error("Cannot find native module 'ExpoImageManipulator'");
});

const photo = {
  uri: 'blob:http://localhost/abc',
  base64: 'AAECAwQF',
  mimeType: 'image/jpeg',
};

describe('resizeForUpload', () => {
  it('always resolves to a usable photo', async () => {
    const out = await resizeForUpload(photo);

    expect(out).toBeTruthy();
    expect(typeof out.uri).toBe('string');
    expect(typeof out.base64).toBe('string');
    expect(out.base64.length).toBeGreaterThan(0);
  });

  it('falls back to the original when it cannot resize', async () => {
    // The degraded path — the one that must not lose the picked image. Here
    // it is reached because the native module is missing (see the mock
    // above); on web it is reached when there is no canvas.
    await expect(resizeForUpload(photo)).resolves.toEqual(photo);
  });

  it('does not throw when the native module is missing', async () => {
    // The assertion that matters most in this file: a missing native module
    // must degrade to "uploads stay full-size until the next store release",
    // never to an app that will not launch.
    await expect(resizeForUpload(photo)).resolves.toBeTruthy();
  });

  it('does not throw on a photo it cannot decode', async () => {
    const junk = { uri: 'not-a-url', base64: '!!!', mimeType: 'image/png' };
    await expect(resizeForUpload(junk)).resolves.toBeTruthy();
  });

  it('preserves the content type when it does not re-encode', async () => {
    // Whatever comes back is what gets DECLARED to storage. A pass-through
    // that dropped or invented a type would put the wrong content type on the
    // object — which is the bug the mimeType field exists to prevent.
    const png = { ...photo, mimeType: 'image/png' };
    await expect(resizeForUpload(png)).resolves.toMatchObject({ mimeType: 'image/png' });
  });
});
