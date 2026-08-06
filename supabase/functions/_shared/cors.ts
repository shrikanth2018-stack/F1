/**
 * 1stOne F1 — CORS origin allow-list (shared by every edge function)
 *
 * WHY THIS FILE EXISTS. Each of the 13 functions carried its own copy of
 *
 *   new Set([SUPABASE_URL, 'http://localhost:8081', 'http://localhost:19006'])
 *
 * and not one of them listed the production web origin. `https://app.1stone.in`
 * has been live on Cloudflare Pages the whole time, so every edge-function call
 * from the web app came back with
 *
 *   Access-Control-Allow-Origin: https://wcvqxzqqwcxlcgrjyunf.supabase.co
 *
 * which does not match the requesting origin, so the BROWSER discarded the
 * response before the app ever saw it. The server had already done the work and
 * returned 200 — the failure is entirely client-side and invisible in logs.
 *
 * THE SYMPTOM IS DELIBERATELY MISLEADING. supabase-js `functions.invoke` fails
 * at the transport layer with no body and no message, so the caller falls back
 * to its own generic copy: "Could not price your cart. Please try again." That
 * reads like a pricing bug, or a stale bundle, or a network blip. It was none
 * of those, and no `eas update` could ever have fixed it — the allow-list is
 * server-side. Web checkout, web wallet top-up and every admin report screen
 * opened on the web were all affected.
 *
 * Thirteen copies of a list is why it drifted, so the list now lives once.
 * Adding a surface means editing THIS file and redeploying the functions.
 *
 * Preview deployments are allowed by suffix: Cloudflare gives every build a
 * `https://<id>.1stone-app.pages.dev` URL, and those are exactly where a
 * release is tested before it is promoted (see docs/06 §Web deploy). A preview
 * that cannot reach the backend is a test that proves nothing.
 *
 * CORS IS NOT THE AUTH BOUNDARY and must never be treated as one — every
 * function verifies the JWT in _shared/auth.ts regardless of origin. This list
 * only decides whose *browser* is allowed to read a reply.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

const EXACT_ORIGINS = new Set([
  SUPABASE_URL,             // server-to-server and the Supabase dashboard
  'https://app.1stone.in',  // production web app (Cloudflare Pages)
  'http://localhost:8081',  // expo web dev server
  'http://localhost:19006', // expo web dev server (legacy port)
]);

/** Cloudflare Pages preview builds: https://<deployment-id>.1stone-app.pages.dev */
const PREVIEW_SUFFIX = '.1stone-app.pages.dev';

export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (EXACT_ORIGINS.has(origin)) return true;
  // startsWith('https://') matters: without it a hostile
  // "http://evil.com#.1stone-app.pages.dev" style origin would pass the suffix
  // test. Preview URLs are always https.
  return origin.startsWith('https://') && origin.endsWith(PREVIEW_SUFFIX);
}
