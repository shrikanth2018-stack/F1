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
 * the phone downloads a thumbnail rather than the upload. Measured on this
 * project: a 48 KB source is served as 6.4 KB WebP at width=240. The admin
 * uploader compresses but does not resize (that needs expo-image-manipulator,
 * a native module — see §9), so originals land around 1-2 MB. Customers never
 * fetch them.
 *
 * Path, not URL, is what's stored on the row — same reason `assetUrl` exists
 * in ./assets: no project-ref in code or data. It also lets one stored photo
 * produce differently-sized URLs for different surfaces.
 */

import { supabase } from '../api/supabaseClient';

/**
 * Storage buckets, one per catalogue.
 *
 * Deliberately NOT one shared bucket. Their write rules differ — menu photos
 * are admin-only forever, essentials photos will additionally be writable by
 * the owning vendor once the listing gate lands. One bucket would mean one
 * policy set doing both jobs, and a mistake in the vendor branch would hand
 * vendors write access to the food menu.
 */
export const PHOTO_BUCKET = {
  menu: 'menu-photos',
  essentials: 'essentials-photos',
} as const;

export type PhotoBucket = (typeof PHOTO_BUCKET)[keyof typeof PHOTO_BUCKET];

/**
 * A picked-but-not-yet-uploaded photo. Held in state until the row exists.
 *
 * Lives here rather than in catalogPhotoUpload.ts because imageResize.ts needs
 * it too, and that file is imported BY the uploader — declaring it there would
 * make the two modules import each other.
 */
export interface PickedPhoto {
  /** Local file URI — for previewing before upload. */
  uri: string;
  /** Base64 payload, required because RN has no File/Blob to hand Supabase. */
  base64: string;
  /**
   * Real content type of `base64`.
   *
   * Carried from the picker rather than assumed. This used to be hardcoded to
   * image/jpeg at upload, which was a lie whenever the web canvas re-encode
   * bailed out and passed the original bytes straight through — a PNG or,
   * worse, a HEIC would land in the bucket labelled JPEG. The bucket's MIME
   * allowlist only checks the DECLARED type, so it sailed past, and the render
   * endpoint then refused to transform it.
   */
  mimeType: string;
}

/**
 * Formats the buckets accept. Mirrors `allowed_mime_types` in
 * menu_item_photos.sql / essentials_photos.sql — the storage layer is the real
 * gate, this copy exists so the admin gets a sentence instead of a 400.
 */
export const ALLOWED_PHOTO_MIME: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/** Mirrors `file_size_limit` on both buckets (8 MB). Same reason as above. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Decoded size of a base64 payload, without allocating it. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** Storage object key for an item's photo. Fixed extension on purpose. */
export function photoPath(bucket: PhotoBucket, itemId: number): string {
  return `${bucket}/${itemId}.jpg`;
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
  /** 76pt customer Home row tile. */
  row: 240,
  /** 48pt admin manager row tile. */
  admin: 150,
} as const;
