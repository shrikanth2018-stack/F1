/**
 * 1stOne F1 — What a catalogue photo may be
 *
 * The shape of a picked photo, and the format/size limits it has to satisfy.
 * Pure data and one arithmetic helper — no imports at all, deliberately.
 *
 * These lived in catalogPhoto.ts, which imports the Supabase client in order
 * to build URLs. That made every consumer of the limits — including the two
 * platform resize builds and the crop dialog, none of which touch the network
 * — transitively depend on a configured Supabase client. It surfaced as a
 * failing test (AsyncStorage does not load under jest's node environment), but
 * a resize utility pulling in a network client was the actual problem; the
 * test was just the first thing to notice.
 *
 * catalogPhoto.ts re-exports everything here, so existing imports still work.
 */

/** A picked-but-not-yet-uploaded photo. Held in state until the row exists. */
export interface PickedPhoto {
  /** Local file URI — for previewing before upload. */
  uri: string;
  /** Base64 payload, required because RN has no File/Blob to hand Supabase. */
  base64: string;
  /**
   * Real content type of `base64`.
   *
   * Carried from the picker rather than assumed. This used to be hardcoded to
   * image/jpeg at upload, which was a lie whenever a re-encode bailed out and
   * passed the original bytes straight through — a PNG or, worse, a HEIC would
   * land in the bucket labelled JPEG. The bucket's MIME allowlist only checks
   * the DECLARED type, so it sailed past, and the render endpoint then refused
   * to transform it.
   *
   * Anything that re-encodes MUST restamp this.
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
