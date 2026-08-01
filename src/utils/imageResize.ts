/**
 * 1stOne F1 — Downscale a picked photo before upload (WEB implementation)
 *
 * Platform split, same convention as PinMap / ZoneMap: this file is the WEB
 * build, `imageResize.native.ts` is the native one.
 *
 * WHY THIS EXISTS. `expo-image-picker`'s web implementation accepts only
 * `mediaTypes`, `allowsMultipleSelection` and `base64` — it silently ignores
 * `quality`, `allowsEditing` and `aspect` (see ExponentImagePicker.web.js).
 * So an admin uploading a menu photo from app.1stone.in sends the ORIGINAL
 * file, untouched. A phone photo off a desktop download folder is routinely
 * 4-8 MB, and the bucket cap is 8 MB — past that the upload fails with a
 * storage error that says nothing useful about size.
 *
 * On web we can fix that with a canvas, which is plain DOM: no native module,
 * so it ships in the ordinary web bundle. That leaves web with BETTER
 * compression than native, where `quality` re-encodes but nothing resizes —
 * proper native resizing needs expo-image-manipulator and a store release
 * (see §9). Worth remembering when that native build eventually happens: the
 * target numbers below are the ones to match.
 *
 * The customer never sees this file's output at full size anyway — the
 * storage render endpoint serves a ~6 KB thumbnail. This is purely about not
 * pushing megabytes into the bucket for no reason.
 */

import type { PickedPhoto } from './catalogPhotoUpload';

/**
 * Longest edge, in pixels, after downscaling.
 *
 * The largest surface that renders a catalogue photo asks the render endpoint
 * for 240px. 1000 leaves generous headroom for a future larger view (an item
 * detail screen, a printed sheet) without storing anything near the original.
 */
const MAX_EDGE = 1000;

/** JPEG quality for the re-encode. Matches the native picker's 0.6-0.7 band. */
const QUALITY = 0.7;

/**
 * Downscale `photo` to at most MAX_EDGE on its longest side and re-encode as
 * JPEG.
 *
 * Returns the ORIGINAL photo unchanged if anything goes wrong — a failed
 * resize must not block an admin from uploading. The worst case is then the
 * pre-existing behaviour (full-size upload), not a broken screen.
 */
export async function resizeForUpload(photo: PickedPhoto): Promise<PickedPhoto> {
  try {
    if (typeof document === 'undefined') return photo;

    const img = await loadImage(photo.uri);
    const { width, height } = img;
    if (!width || !height) return photo;

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return photo;

    // A transparent PNG would otherwise flatten onto black once encoded as
    // JPEG. White is the safer default for a product photo on a white
    // background; a photo on black is unaffected because it has no alpha.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
    const base64 = dataUrl.split(',')[1];
    if (!base64) return photo;

    // Never hand back something LARGER than what we were given. Re-encoding a
    // small, already-optimised JPEG can inflate it; in that case the original
    // is the better upload.
    if (base64.length >= photo.base64.length) return photo;

    return { uri: dataUrl, base64 };
  } catch {
    return photo;
  }
}

/** Decode a blob: or data: URL into an <img> we can draw. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode picked image'));
    img.src = src;
  });
}
