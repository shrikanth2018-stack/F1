/**
 * 1stOne F1 — Catalogue photo picking + upload
 *
 * Shared by every admin surface that sets a picture, across both catalogues:
 * CreateMenuScreen and MenuManageScreen for food, CreateEssentialScreen and
 * EssentialsCatalogManageScreen for essentials. All of them go through here
 * so the compression settings and — more importantly — the replace-in-place
 * rule can only be defined once.
 *
 * REPLACE, NEVER ACCUMULATE. The object key is the item id with a fixed
 * `.jpg` extension, uploaded with `upsert: true`. A second upload overwrites
 * the same object, so an item physically cannot end up with two pictures and
 * there is no orphan to clean up afterwards. This is deliberately different
 * from the banner/login-background uploaders in `assets`, which write a
 * timestamped filename and then best-effort delete the previous one — that
 * pattern needs the delete to succeed to stay clean; this one cannot leak.
 *
 * The trade-off a fixed key buys us is CDN staleness, handled by stamping
 * `image_updated_at` and appending it as `?v=` at render (catalogPhoto.ts).
 *
 * COMPRESSION. `quality` on the picker re-encodes but does NOT resize —
 * resizing needs expo-image-manipulator, a native module, which would cost a
 * store release and cannot ship over the air. Originals therefore land around
 * 1-2 MB. That is acceptable precisely because customers never fetch them:
 * the storage render endpoint serves a ~6 KB thumbnail. Revisit at the next
 * native build.
 *
 * Uploads are admin-only at the database level (menu_item_photos.sql,
 * essentials_photos.sql), so a non-admin reaching this code fails at the
 * storage policy rather than on trust in the UI hiding the button. When the
 * vendor listing gate lands, vendor writes go to a SEPARATE private bucket
 * and must not be added here — this path writes straight to the live,
 * publicly readable object.
 */

import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../api/supabaseClient';
import { photoPath, objectKeyFromPath, type PhotoBucket } from './catalogPhoto';
// Platform-split (imageResize.ts = web, imageResize.native.ts = native).
// Web downscales via canvas because the picker ignores `quality` there;
// native is a pass-through. See either file for the full reasoning.
import { resizeForUpload } from './imageResize';

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

/** A picked-but-not-yet-uploaded photo. Held in state until the row exists. */
export interface PickedPhoto {
  /** Local file URI — for previewing before upload. */
  uri: string;
  /** Base64 payload, required because RN has no File/Blob to hand Supabase. */
  base64: string;
}

/**
 * Ask for a square photo from the library.
 *
 * Returns null if permission is refused or the picker is cancelled — both are
 * ordinary outcomes, not errors, and callers should simply do nothing.
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
  if (result.canceled || !result.assets?.[0]?.base64) return null;

  return resizeForUpload({
    uri: result.assets[0].uri,
    base64: result.assets[0].base64,
  });
}

/**
 * Upload `photo` as the picture for `itemId` and record it on the row.
 *
 * Ordering matters: the object is written first, the row second. If the row
 * update fails, the bucket holds an object no row points at — invisible, and
 * overwritten by the next upload for that item. The reverse order would point
 * a row at an object that does not exist, which is a visibly broken tile.
 *
 * Always writes `image_updated_at`; without it the CDN would keep serving the
 * previous photo from the unchanged URL.
 *
 * Throws on failure so callers can surface a message — this is an admin
 * action with a visible result, not something to fail silently.
 */
export async function uploadCatalogPhoto(
  bucket: PhotoBucket,
  itemId: number,
  photo: PickedPhoto,
): Promise<void> {
  const key = objectKeyFromPath(bucket, photoPath(bucket, itemId));

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(key, decode(photo.base64), {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: String(PHOTO_CACHE_SECONDS),
    });
  if (uploadError) throw new Error(uploadError.message);

  const { error: rowError } = await supabase
    .from(TABLE_FOR_BUCKET[bucket])
    .update({
      image_path: photoPath(bucket, itemId),
      image_updated_at: new Date().toISOString(),
    })
    .eq('id', itemId);
  if (rowError) throw new Error(rowError.message);
}

/**
 * Remove an item's photo — object first, then the row's pointer.
 *
 * The row is cleared even if the object delete failed: a row pointing at a
 * missing object renders a broken tile, whereas an orphaned object is
 * invisible and gets overwritten by the next upload for that id.
 */
export async function removeCatalogPhoto(
  bucket: PhotoBucket,
  itemId: number,
): Promise<void> {
  const key = objectKeyFromPath(bucket, photoPath(bucket, itemId));
  await supabase.storage.from(bucket).remove([key]).catch(() => null);

  const { error } = await supabase
    .from(TABLE_FOR_BUCKET[bucket])
    .update({ image_path: null, image_updated_at: null })
    .eq('id', itemId);
  if (error) throw new Error(error.message);
}
