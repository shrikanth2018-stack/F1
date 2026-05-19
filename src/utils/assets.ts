/**
 * 1stOne F1 — Storage asset URLs.
 *
 * The single way to build a public URL for a file in the `assets` storage
 * bucket (logo, banner, Privacy/Terms PDFs). Replaces three divergent
 * patterns — `supabase.storage.getPublicUrl`, a `process.env` string concat,
 * and literal project-ref URLs — so no project-ref ever lives in code.
 */

import { supabase } from '../api/supabaseClient';

/** Public URL for `path` inside the `assets` storage bucket. */
export function assetUrl(path: string): string {
  return supabase.storage.from('assets').getPublicUrl(path).data.publicUrl;
}
