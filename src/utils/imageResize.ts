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
 * On web we fix that with a canvas, which is plain DOM: no native module, so
 * it ships in the ordinary web bundle.
 *
 * Native now downscales too, via expo-image-manipulator — the constants in
 * both files are the same numbers on purpose, so the two platforms cannot
 * quietly produce different uploads for the same photo. Change one, change the
 * other.
 *
 * This runs AFTER the square crop (photoCrop.ts), so on web the input is
 * already a cropped square rather than whatever came off disk.
 *
 * The customer never sees this file's output at full size anyway — the
 * storage render endpoint serves a ~5 KB WebP thumbnail. This is purely about
 * not pushing megabytes into the bucket for no reason.
 */

import { ALLOWED_PHOTO_MIME, type PickedPhoto } from './photoFormat';

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
    //
    // Unless the original is a format the bucket will not accept. A HEIC that
    // this browser managed to decode is exactly that case: the re-encode may
    // well be bigger, but it is the only version that can be uploaded at all,
    // so size stops being the deciding factor.
    const originalIsUploadable = ALLOWED_PHOTO_MIME.includes(photo.mimeType);
    if (originalIsUploadable && base64.length >= photo.base64.length) return photo;

    // The canvas always encodes to JPEG here, whatever went in — so this is
    // the one place the type genuinely changes, and it has to be recorded or
    // the upload would declare the ORIGINAL type for re-encoded bytes.
    return { uri: dataUrl, base64, mimeType: 'image/jpeg' };
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
