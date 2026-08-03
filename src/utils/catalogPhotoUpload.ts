/**
 * 1stOne F1 — Catalogue photo picking + upload
 *
 * Shared by every surface that sets a picture, across both catalogues:
 * the Menu Manager's two editors for food, CreateEssentialScreen and
 * EssentialsCatalogManageScreen for essentials, and VendorDashboardScreen for
 * a vendor's own items. All of them go through here so the compression
 * settings and — more importantly — the replace-in-place rule can only be
 * defined once.
 *
 * REPLACE, NEVER ACCUMULATE. The object key is the item id with a fixed
 * `.jpg` extension, uploaded with `upsert: true`. A second upload overwrites
 * the same object, so an item physically cannot end up with two pictures and
 * there is no orphan to clean up afterwards. This is deliberately different
 * from the banner/login-background uploaders in `assets`, which write a
 * timestamped filename and then best-effort delete the previous one — that
 * pattern needs the delete to succeed to stay clean; this one cannot leak.
 *
 * The `.jpg` in the key is a SLOT NAME, not a claim about the format. What is
 * actually served comes from the content type recorded on the object, which
 * is now whatever was really picked (see PickedPhoto.mimeType). Keeping the
 * extension fixed is what makes replacement atomic; a varying one would leave
 * `12.jpg` AND `12.webp` behind on a format change.
 *
 * The trade-off a fixed key buys us is CDN staleness, handled by stamping
 * `image_updated_at` and appending it as `?v=` at render (catalogPhoto.ts).
 *
 * BOTH WRITES ARE VERIFIED. An UPDATE that RLS rejects is not an error — it
 * matches zero rows and returns success. Every row write here therefore asks
 * for the affected id back and treats an empty result as a failure. Without
 * that, an admin editing an item outside their branch uploaded the file, saw
 * no error, and watched nothing happen; and "remove photo" reported success
 * while the picture stayed on the customer menu.
 *
 * WHO MAY WRITE is decided by the database, not by this file or by which
 * buttons a screen renders — see catalog_photo_policies.sql, which gates the
 * bucket on the same branch test the catalogue tables use, plus ownership for
 * a vendor writing their own item's photo.
 */

import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../api/supabaseClient';
import { captureError } from './sentry';
import {
  photoPath,
  pendingPhotoPath,
  objectKeyFromPath,
  PHOTO_BUCKET,
  ALLOWED_PHOTO_MIME,
  MAX_PHOTO_BYTES,
  base64ByteLength,
  type PhotoBucket,
  type PickedPhoto,
} from './catalogPhoto';
// Platform-split (imageResize.ts = web, imageResize.native.ts = native).
// Web downscales via canvas because the picker ignores `quality` there;
// native is a pass-through. See either file for the full reasoning.
import { resizeForUpload } from './imageResize';
// Square crop. Pass-through on native (the OS cropper already ran); opens the
// crop dialog on web, where the picker has no crop step at all.
import { cropToSquare } from './photoCrop';

export type { PickedPhoto } from './catalogPhoto';

/**
 * Cache lifetime sent with the object, in seconds (30 days).
 *
 * Supabase storage defaults an upload to `cache-control: no-cache`, which
 * propagates to the render endpoint — measured on the first batch of photos,
 * every launch re-fetched every thumbnail instead of using the CDN. A long
 * max-age is safe here ONLY because the delivered URL carries ?v=
 * image_updated_at, so a replaced photo is a different URL and can never be
 * served stale (see catalogPhoto.ts).
 *
 * 30 days rather than a year deliberately: if a row ever ends up with a photo
 * but no stamp, the URL stops changing and the cache becomes the only thing
 * standing between the customer and a stale picture. A month self-heals; a
 * year is effectively permanent.
 */
const PHOTO_CACHE_SECONDS = 2592000;

/** Table a bucket's rows live in, so one uploader can serve both catalogues. */
const TABLE_FOR_BUCKET: Record<PhotoBucket, 'menu_items' | 'essentials_catalog'> = {
  'menu-photos': 'menu_items',
  'essentials-photos': 'essentials_catalog',
};

/**
 * Shown when a row write affects nothing.
 *
 * Deliberately does not guess WHY — the policy could have refused on branch,
 * on vendor ownership, or the row could have been deleted underneath us. What
 * matters to whoever is standing there is that nothing changed.
 */
const NO_ROW_MESSAGE =
  'That item could not be updated — it may belong to a different branch, or to someone else. Nothing on the customer menu has changed.';

/** Friendly name for a format we cannot accept, for the message below. */
function describeFormat(mimeType: string): string {
  const known: Record<string, string> = {
    'image/heic': 'HEIC',
    'image/heif': 'HEIF',
    'image/avif': 'AVIF',
    'image/gif': 'GIF',
    'image/svg+xml': 'SVG',
  };
  return known[mimeType] ?? mimeType.replace(/^image\//, '').toUpperCase();
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Refuse a photo the bucket would refuse anyway, with a sentence that says
 * what to do about it.
 *
 * Checked after the resize, not before: on web the canvas re-encodes to JPEG,
 * so a HEIC that Safari can decode passes here even though the picked file
 * could not. Browsers that cannot decode it fall through and get the message.
 */
export function assertUploadablePhoto(photo: PickedPhoto): void {
  if (!ALLOWED_PHOTO_MIME.includes(photo.mimeType)) {
    throw new Error(
      `${describeFormat(photo.mimeType)} pictures cannot be uploaded. Please choose a JPG, PNG or WebP. ` +
        'On an iPhone, Settings → Camera → Formats → Most Compatible saves new photos as JPG.',
    );
  }

  const bytes = base64ByteLength(photo.base64);
  if (bytes > MAX_PHOTO_BYTES) {
    throw new Error(
      `That picture is ${formatMb(bytes)}, and the limit is ${formatMb(MAX_PHOTO_BYTES)}. Please choose a smaller one.`,
    );
  }
}

/**
 * Ask for a square photo from the library.
 *
 * Returns null if permission is refused or the picker is cancelled — both are
 * ordinary outcomes, not errors, and callers should simply do nothing.
 *
 * THROWS for a picture we cannot use (wrong format, too large). That is a real
 * outcome the admin needs told about, so callers must keep this inside the
 * same try/catch as the upload.
 *
 * Square crop is forced here rather than at render: `resize=cover` would crop
 * a landscape shot to a square anyway, and letting the admin choose WHICH
 * square avoids the endpoint centre-cropping the food out of frame.
 */
export async function pickCatalogPhoto(): Promise<PickedPhoto | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    // NOTE: allowsEditing, aspect and quality are honoured on NATIVE only.
    // expo-image-picker's web implementation accepts just mediaTypes,
    // allowsMultipleSelection and base64 — the rest are silently dropped, so
    // on web there is no square-crop step and no re-encode. resizeForUpload
    // below is what covers the web gap; the render endpoint's resize=cover
    // handles the missing crop.
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.6,
    base64: true,
  });

  const asset = result.assets?.[0];
  if (result.canceled || !asset?.base64) return null;

  // Size is checked HERE, before anything decodes the file, and again at the
  // end once the crop and resize have had their say.
  //
  // The final check is the one that decides what may be uploaded; this one
  // exists so a 40 MB file is refused in a moment instead of being drawn into
  // a canvas first. Decoding a file that large is where a browser tab visibly
  // hangs, and the admin's only clue would be a frozen form.
  //
  // The ceiling is generous on purpose: crop and resize normally bring a big
  // photo well under the limit, so refusing early on the RAW size would reject
  // pictures that would have been perfectly fine. 4x the bucket cap only
  // catches files no amount of resizing would rescue.
  const rawBytes = base64ByteLength(asset.base64);
  if (rawBytes > MAX_PHOTO_BYTES * 4) {
    throw new Error(
      `That picture is ${formatMb(rawBytes)}, which is far too large to work with. ` +
        'Please choose one under 8 MB, or export it at a smaller size first.',
    );
  }

  // ── crop → resize → validate ──
  //
  // Crop first, and always to a square. On native the OS cropper has already
  // run and this is a pass-through; on web it opens PhotoCropHost, because the
  // web picker ignores allowsEditing entirely. Cropping BEFORE the resize
  // matters: resizing first would spend quality on pixels about to be
  // discarded, and would cap the crop's usable resolution.
  const cropped = await cropToSquare({
    uri: asset.uri,
    base64: asset.base64,
    // The web picker reports the file's real type; native reports the type it
    // re-encoded to. Falling back to JPEG only when neither said anything.
    mimeType: asset.mimeType || 'image/jpeg',
  });
  // Backed out of the crop. Same as cancelling the picker — say nothing.
  if (!cropped) return null;

  const photo = await resizeForUpload(cropped);

  assertUploadablePhoto(photo);
  return photo;
}

/**
 * Upload `photo` as the picture for `itemId` and record it on the row.
 *
 * Ordering matters: the object is written first, the row second. If the row
 * update fails we say so and stop; the bucket is left holding an object no row
 * points at — invisible, and overwritten by the next upload for that item. The
 * reverse order would point a row at an object that does not exist, which is a
 * visibly broken tile.
 *
 * Always writes `image_updated_at`; without it the CDN would keep serving the
 * previous photo from the unchanged URL.
 *
 * Throws on failure so callers can surface a message — this is a deliberate
 * action with a visible result, not something to fail silently.
 */
export async function uploadCatalogPhoto(
  bucket: PhotoBucket,
  itemId: number,
  photo: PickedPhoto,
): Promise<void> {
  // Re-checked here rather than trusted from the pick: the menu and essential
  // editors hold a picked photo in state across a save, so the two calls can
  // be a long way apart.
  assertUploadablePhoto(photo);

  const key = objectKeyFromPath(bucket, photoPath(bucket, itemId));

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(key, decode(photo.base64), {
      contentType: photo.mimeType,
      upsert: true,
      cacheControl: String(PHOTO_CACHE_SECONDS),
    });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error: rowError } = await supabase
    .from(TABLE_FOR_BUCKET[bucket])
    .update({
      image_path: photoPath(bucket, itemId),
      image_updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .select('id');
  if (rowError) throw new Error(rowError.message);
  // Zero rows means RLS refused the write. PostgREST reports that as success,
  // so without this the picture uploads and the item silently keeps the old
  // one (or none at all).
  if (!data?.length) throw new Error(NO_ROW_MESSAGE);
}

/**
 * Upload a PROPOSED replacement photo for a live listing.
 *
 * Writes to `pending/{id}.jpg` and deliberately does NOT touch the row: the
 * item is still selling with its current picture, and that must not change
 * until an admin approves. `image_path` already points at the live key, so
 * there is nothing to update — approval promotes the object instead.
 */
export async function uploadPendingCatalogPhoto(
  itemId: number,
  photo: PickedPhoto,
): Promise<void> {
  assertUploadablePhoto(photo);

  const bucket = PHOTO_BUCKET.essentials;
  const key = objectKeyFromPath(bucket, pendingPhotoPath(itemId));

  const { error } = await supabase.storage
    .from(bucket)
    .upload(key, decode(photo.base64), {
      contentType: photo.mimeType,
      upsert: true,
      cacheControl: String(PHOTO_CACHE_SECONDS),
    });
  if (error) throw new Error(error.message);
}

/**
 * Move an approved photo from the pending key to the live one.
 *
 * Called BEFORE `admin_review_listing_change`, never after. `image_updated_at`
 * is the CDN cache-buster, so stamping it while the old bytes are still at the
 * live key publishes a fresh URL pointing at the previous picture — and the
 * cache then holds that for its full 30-day lifetime. Bytes first, stamp
 * second.
 *
 * `move` rather than copy-then-delete: one call, and it cannot leave both.
 */
export async function promotePendingPhoto(itemId: number): Promise<void> {
  const bucket = PHOTO_BUCKET.essentials;
  const from = objectKeyFromPath(bucket, pendingPhotoPath(itemId));
  const to = objectKeyFromPath(bucket, photoPath(bucket, itemId));

  const { error } = await supabase.storage.from(bucket).move(from, to);
  if (error) throw new Error(error.message);
}

/**
 * Throw away a proposed photo that was rejected, or that has been superseded.
 *
 * Best-effort and never throws: the decision itself is already recorded, and a
 * leftover object at the pending key is invisible to customers and overwritten
 * by the vendor's next proposal. Reported so it is not simply lost.
 */
export async function discardPendingPhoto(itemId: number): Promise<void> {
  const bucket = PHOTO_BUCKET.essentials;
  const key = objectKeyFromPath(bucket, pendingPhotoPath(itemId));

  const { error } = await supabase.storage.from(bucket).remove([key]);
  if (error) {
    captureError(new Error(`pending photo not discarded: ${error.message}`), { itemId, key });
  }
}

/** What actually happened when a photo was removed. */
export interface PhotoRemoval {
  /**
   * FALSE when the row was cleared but the image file itself could not be
   * deleted. The item stops showing a picture either way; the file is left
   * behind, unreferenced, and the next upload for this item overwrites it.
   */
  fileRemoved: boolean;
}

/**
 * Remove an item's photo — the row's pointer first, then the object.
 *
 * ROW FIRST, deliberately. The row write is the one RLS can refuse, so doing
 * it first means a refusal changes nothing at all; the caller gets an error
 * and the picture is still there to try again. The old order deleted the file
 * before discovering it was not allowed to clear the row, which left the item
 * pointing at nothing.
 *
 * A failed file delete is reported rather than swallowed. It used to be
 * discarded twice over — `.catch()` on a call that resolves with an `error`
 * field instead of rejecting, so the handler never even ran. These buckets are
 * public and the keys are guessable, so a file left behind stays fetchable by
 * anyone who knows the item id; that is worth knowing about.
 */
export async function removeCatalogPhoto(
  bucket: PhotoBucket,
  itemId: number,
): Promise<PhotoRemoval> {
  const key = objectKeyFromPath(bucket, photoPath(bucket, itemId));

  const { data, error } = await supabase
    .from(TABLE_FOR_BUCKET[bucket])
    .update({ image_path: null, image_updated_at: null })
    .eq('id', itemId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error(NO_ROW_MESSAGE);

  const { error: fileError } = await supabase.storage.from(bucket).remove([key]);
  if (fileError) {
    captureError(new Error(`catalogue photo file not deleted: ${fileError.message}`), {
      bucket,
      key,
      itemId,
    });
    return { fileRemoved: false };
  }

  return { fileRemoved: true };
}
