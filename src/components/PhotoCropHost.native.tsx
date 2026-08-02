/**
 * 1stOne F1 — Square crop dialog (NATIVE implementation)
 *
 * Renders nothing, deliberately.
 *
 * `expo-image-picker` runs the OS cropper before it ever returns on iOS and
 * Android — `allowsEditing: true, aspect: [1, 1]` in pickCatalogPhoto — so the
 * photo is already a square by the time any of our code sees it. The system
 * cropper is better than anything we would build here and is what users
 * already know, so the right amount of native cropping UI is none.
 *
 * `cropToSquare` in photoCrop.ts is a pass-through on native for the same
 * reason and never calls a handler, so nothing has to be registered.
 *
 * This file exists so App.tsx can mount <PhotoCropHost /> unconditionally
 * without a Platform check, and — more importantly — so `react-easy-crop`,
 * which is react-dom based, is never pulled into the native bundle.
 */

export function PhotoCropHost() {
  return null;
}
