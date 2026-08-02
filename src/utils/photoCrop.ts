/**
 * 1stOne F1 — Square crop before upload
 *
 * Every catalogue photo is cropped to 1:1 before it leaves the device.
 *
 * WHY 1:1. The storage render endpoint is asked for `resize=cover`, which
 * crops to a square on delivery no matter what was uploaded — so a landscape
 * photo was ALREADY being squared, just by a centre-crop that nobody chose and
 * that routinely took the food out of frame. Locking the crop to a square in
 * the UI does not impose a new constraint; it hands an existing one to the
 * person who can judge it. Every tile that renders a catalogue photo is
 * square, so one stored square serves every surface with no letterboxing.
 *
 * TWO PLATFORMS, TWO MECHANISMS, ONE RESULT:
 *
 *   native  `expo-image-picker` runs the OS cropper before it ever returns —
 *           `allowsEditing: true, aspect: [1, 1]`. Nothing to add, and the
 *           system cropper is better than anything we would build. This module
 *           is a pass-through there.
 *
 *   web     the picker silently ignores `allowsEditing` and `aspect` (see
 *           ExponentImagePicker.web.js — it accepts only mediaTypes,
 *           allowsMultipleSelection and base64), so a web admin had no crop
 *           step at all. That gap is what PhotoCropHost fills.
 *
 * The handler indirection mirrors `confirmDialog` exactly: a host component
 * mounted once at app root registers itself here, and callers get a plain
 * promise. That is what keeps `pickCatalogPhoto` a single async call and
 * leaves all five picker call sites untouched.
 */

import { Platform } from 'react-native';
import type { PickedPhoto } from './photoFormat';

/** Aspect ratio for every catalogue photo. Square, on purpose — see above. */
export const PHOTO_ASPECT = 1;

type CropHandler = (photo: PickedPhoto) => Promise<PickedPhoto | null>;

let cropHandler: CropHandler | null = null;

/** Internal — PhotoCropHost calls this once on mount. Not for app code. */
export function _registerCropHandler(handler: CropHandler) {
  cropHandler = handler;
}

/**
 * Let the user square up `photo`, resolving to the cropped result.
 *
 * Resolves to `null` if they back out — an ordinary outcome that callers
 * should treat exactly like cancelling the picker.
 *
 * Falls through to the original photo when there is nothing to crop with:
 * native (already cropped by the OS) and, on web, the window between app boot
 * and PhotoCropHost mounting. Degrading to an uncropped upload is right —
 * `resize=cover` still squares it on delivery, so the customer sees a correct
 * tile either way, and refusing the upload would be a worse trade than an
 * unattended centre-crop.
 */
export function cropToSquare(photo: PickedPhoto): Promise<PickedPhoto | null> {
  if (Platform.OS !== 'web') return Promise.resolve(photo);
  if (!cropHandler) return Promise.resolve(photo);
  return cropHandler(photo);
}
