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

const photo = { uri: 'blob:http://localhost/abc', base64: 'AAECAwQF' };

describe('resizeForUpload', () => {
  it('always resolves to a usable photo', async () => {
    const out = await resizeForUpload(photo);

    expect(out).toBeTruthy();
    expect(typeof out.uri).toBe('string');
    expect(typeof out.base64).toBe('string');
    expect(out.base64.length).toBeGreaterThan(0);
  });

  it('falls back to the original when it cannot resize', async () => {
    // No canvas in this environment, so this is the degraded path — the one
    // that must not lose the admin's picked image.
    await expect(resizeForUpload(photo)).resolves.toEqual(photo);
  });

  it('does not throw on a photo it cannot decode', async () => {
    const junk = { uri: 'not-a-url', base64: '!!!' };
    await expect(resizeForUpload(junk)).resolves.toBeTruthy();
  });
});
