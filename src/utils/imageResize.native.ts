/**
 * 1stOne F1 — Downscale a picked photo before upload (NATIVE implementation)
 *
 * Platform split, same convention as PinMap / ZoneMap: `imageResize.ts` is the
 * web build, this is native.
 *
 * This file used to be an honest no-op. `expo-image-picker`'s `quality: 0.6`
 * re-encodes at pick time but does NOT reduce pixel dimensions, so a phone
 * photo landed in the bucket at 1–2 MB — and proper resizing needs
 * `expo-image-manipulator`, a native module that cannot ship over the air.
 * That module is now a dependency (added in the same change as web cropping,
 * which is why a store release was worth cutting), so this does the real work.
 *
 * WIDTH ONLY, deliberately. Passing both dimensions would stretch anything
 * that is not already square; passing width alone lets the library derive the
 * height and preserve the ratio. The OS cropper has already squared the image
 * by this point — `allowsEditing: true, aspect: [1, 1]` — so in practice the
 * result IS square, but a resize that only stays correct because of an
 * assumption elsewhere is a trap for whoever changes the picker next.
 *
 * Constants match the web build on purpose. Two platforms producing visibly
 * different uploads for the same photo is the thing this split exists to
 * avoid, not to cause.
 *
 * JPEG, not WebP. The storage render endpoint transcodes to WebP on delivery
 * regardless of what is stored (verified: a 46 KB JPEG original is served as
 * 5.3 KB WebP at width=240), so converting here would save bucket space and
 * change nothing a customer experiences — and `SaveFormat.WEBP` is
 * Android-only, so it would also make the two platforms diverge for no gain.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { ALLOWED_PHOTO_MIME, type PickedPhoto } from './photoFormat';

/**
 * Longest edge, in pixels, after downscaling. Matches imageResize.ts.
 *
 * The largest surface that renders a catalogue photo asks the render endpoint
 * for 240px. 1000 leaves generous headroom for a future larger view without
 * storing anything near the original.
 */
const MAX_EDGE = 1000;

/** JPEG quality for the re-encode. Matches imageResize.ts. */
const QUALITY = 0.7;

/**
 * Downscale `photo` to at most MAX_EDGE on its longest side and re-encode.
 *
 * Returns the ORIGINAL photo unchanged if anything goes wrong. A failed
 * resize must never block an admin or a vendor from setting a picture — the
 * worst case is then the previous behaviour (a larger upload), not a broken
 * screen. The size ceiling in catalogPhotoUpload still catches anything the
 * bucket would refuse outright.
 */
export async function resizeForUpload(photo: PickedPhoto): Promise<PickedPhoto> {
  try {
    const rendered = await ImageManipulator.manipulate(photo.uri)
      .resize({ width: MAX_EDGE })
      .renderAsync();

    const result = await rendered.saveAsync({
      compress: QUALITY,
      format: SaveFormat.JPEG,
      base64: true,
    });

    if (!result.base64) return photo;

    // Never hand back something LARGER than what we were given. A photo
    // already smaller than MAX_EDGE is not downscaled, so this re-encode can
    // inflate an already-optimised file — in that case the original is the
    // better upload.
    //
    // Skipped when the original is a format the bucket will not accept: the
    // re-encoded JPEG is then the only version that can be uploaded at all,
    // so size stops being the deciding factor. Same rule as the web build.
    const originalIsUploadable = ALLOWED_PHOTO_MIME.includes(photo.mimeType);
    if (originalIsUploadable && result.base64.length >= photo.base64.length) {
      return photo;
    }

    // The re-encode is always JPEG here, whatever went in, so the type has to
    // be restamped — otherwise the upload would declare the ORIGINAL type for
    // bytes that are no longer in it.
    return { uri: result.uri, base64: result.base64, mimeType: 'image/jpeg' };
  } catch {
    return photo;
  }
}
