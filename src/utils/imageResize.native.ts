/**
 * 1stOne F1 — Downscale a picked photo before upload (NATIVE implementation)
 *
 * Platform split, same convention as PinMap / ZoneMap: `imageResize.ts` is the
 * web build, this is native.
 *
 * NATIVE DOES NOT RESIZE — deliberately, and this is a pass-through.
 *
 * On native, `expo-image-picker` already honours `quality: 0.6`, so the file
 * is re-encoded at pick time; what it does NOT do is reduce pixel dimensions,
 * which is why an upload from a phone lands around 1-2 MB rather than the
 * ~120 KB it could be. Fixing that needs `expo-image-manipulator`, a native
 * module — adding it means a new binary and a Play Store release, and cannot
 * ship over the air. That trade was made deliberately: the customer never
 * downloads the original (the storage render endpoint serves a ~6 KB
 * thumbnail), so the only cost is storage nobody notices at this catalogue
 * size.
 *
 * There is no canvas here, so the web approach does not transfer.
 *
 * WHEN THE NEXT NATIVE BUILD HAPPENS: add expo-image-manipulator and
 * implement this properly, matching the web constants (1000px longest edge,
 * JPEG quality 0.7). Until then the honest thing is to do nothing rather than
 * pretend — a silently-ineffective resize would be worse than none.
 *
 * Passing the photo through unchanged includes its `mimeType`. That is
 * correct here and not an oversight: nothing in this file re-encodes, so
 * whatever the picker reported is still what the bytes are. The web build,
 * which does re-encode, is the one that has to restamp it.
 */

import type { PickedPhoto } from './catalogPhoto';

export async function resizeForUpload(photo: PickedPhoto): Promise<PickedPhoto> {
  return photo;
}
