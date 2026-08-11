/**
 * 1stOne F1 — Catalogue photo URLs
 *
 * One photo per catalogue item, for BOTH catalogues — `menu_items` (food) and
 * `essentials_catalog`. They are separate tables with separate buckets, but
 * the storage rule, the URL shape and the cache handling are identical, so
 * they live here once rather than being copied per catalogue. The vendor
 * photo work will add a third caller; it must reuse this, not fork it.
 *
 * ONE PHOTO PER ITEM, ENFORCED BY THE PATH. The object key is the item id
 * with a FIXED `.jpg` extension (`menu-photos/12.jpg`), uploaded with upsert.
 * A re-upload overwrites that exact object, so an item cannot accumulate a
 * second picture and there is no orphan to clean up. A varying extension
 * would leave `12.jpg` AND `12.webp` behind on a format change.
 *
 * The one cost of a fixed key is that the URL never changes, so the Supabase
 * CDN would serve the OLD bytes for the whole cache lifetime after a
 * replacement. `image_updated_at` is appended as `?v=` to break that. Both
 * halves are required — changing one without the other silently serves a
 * stale photo.
 *
 * Delivery goes through the storage RENDER endpoint, not the raw object, so
 * the phone downloads a thumbnail rather than the upload. Measured against
 * production: a 46 KB JPEG original is served as 5.3 KB WebP at width=240,
 * 2.9 KB at width=150. WebP is automatic — Supabase negotiates on the Accept
 * header and falls back to JPEG for anything that cannot take it, so there is
 * no format handling to do here.
 *
 * Uploads are cropped square and downscaled to 1000px on BOTH platforms now
 * (photoCrop.ts + imageResize.*), so stored originals are ~120 KB rather than
 * the 1-2 MB they used to be.
 *
 * Path, not URL, is what's stored on the row — same reason `assetUrl` exists
 * in ./assets: no project-ref in code or data. It also lets one stored photo
 * produce differently-sized URLs for different surfaces.
 */

import { supabase } from '../api/supabaseClient';

// The picked-photo shape and the format/size limits live in a leaf module with
// no imports, so the resize builds and the crop dialog can use them without
// dragging in the Supabase client. Re-exported so existing imports still work.
export {
  ALLOWED_PHOTO_MIME,
  MAX_PHOTO_BYTES,
  base64ByteLength,
  type PickedPhoto,
} from './photoFormat';

/**
 * Storage buckets, one per catalogue.
 *
 * Deliberately NOT one shared bucket, for two independent reasons.
 *
 * Their write rules differ — menu photos are admin-only forever, essentials
 * photos will additionally be writable by the owning vendor once the listing
 * gate lands. One bucket would mean one policy set doing both jobs, and a
 * mistake in the vendor branch would hand vendors write access to the food
 * menu.
 *
 * And the ids collide. `photoPath` is `<bucket>/<id>.jpg`, but the three id
 * sequences are independent — plan 26, menu item 26 and essential 26 are
 * different things. Sharing a bucket would have them overwrite each other's
 * pictures, silently, in upload order.
 */
export const PHOTO_BUCKET = {
  menu: 'menu-photos',
  essentials: 'essentials-photos',
  plans: 'plan-photos',
} as const;

export type PhotoBucket = (typeof PHOTO_BUCKET)[keyof typeof PHOTO_BUCKET];

/** Storage object key for an item's photo. Fixed extension on purpose. */
export function photoPath(bucket: PhotoBucket, itemId: number): string {
  return `${bucket}/${itemId}.jpg`;
}

/**
 * Where a PROPOSED replacement photo waits while an admin reviews it.
 *
 * A vendor editing a live listing must not overwrite the picture customers
 * are looking at right now — the whole point of gating an edit is that the
 * current version keeps selling untouched. So a proposed photo goes to a
 * second key and is moved into place only on approval.
 *
 * Essentials only: the food menu has no vendor and no review step.
 */
export function pendingPhotoPath(itemId: number): string {
  return `${PHOTO_BUCKET.essentials}/pending/${itemId}.jpg`;
}

/**
 * Strip the bucket prefix off a stored `image_path`.
 *
 * Rows store `menu-photos/12.jpg` (readable in the DB, and unambiguous about
 * which bucket), but every storage API call wants the key WITHIN the bucket —
 * `12.jpg`. Tolerates a path stored either way.
 */
export function objectKeyFromPath(bucket: PhotoBucket, imagePath: string): string {
  const prefix = `${bucket}/`;
  return imagePath.startsWith(prefix) ? imagePath.slice(prefix.length) : imagePath;
}

export interface PhotoSource {
  image_path?: string | null;
  image_updated_at?: string | null;
}

/**
 * Public, resized URL for an item's photo — or null when it has none.
 *
 * `size` is the requested pixel width AND height; pass the rendered point
 * size multiplied for screen density. A single fixed value across devices
 * maximises CDN hit rate, so callers should prefer PHOTO_PX below over a
 * per-device computation.
 *
 * resize=cover crops to a square rather than letterboxing, which is what the
 * fixed-size tile in the UI needs.
 */
export function photoUrl(
  bucket: PhotoBucket,
  item: PhotoSource,
  size: number,
): string | null {
  if (!item.image_path) return null;

  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(objectKeyFromPath(bucket, item.image_path), {
      transform: { width: size, height: size, resize: 'cover', quality: 70 },
    });
  if (!data?.publicUrl) return null;

  // Cache-bust a replaced photo at an unchanged path. Falls back to the raw
  // URL when the column is null or unparseable (rows written before this
  // shipped, or a partially applied upload) rather than emitting `?v=NaN`.
  const stamp = item.image_updated_at ? Date.parse(item.image_updated_at) : NaN;
  if (Number.isNaN(stamp)) return data.publicUrl;

  return `${data.publicUrl}${data.publicUrl.includes('?') ? '&' : '?'}v=${stamp}`;
}

/**
 * Requested pixel sizes. Point size × 3 covers the densest screens we ship
 * to; asking for one size per device would fragment the CDN cache for no
 * visible gain.
 */
export const PHOTO_PX = {
  /** 66pt customer Home row tile. Held at 240 rather than dropped with the
   *  tile: it is already comfortably above 3x, and changing it would orphan
   *  every cached 240px render on the CDN for no visible gain. */
  row: 240,
  /** 48pt admin manager row tile. */
  admin: 150,
} as const;
