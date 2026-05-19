/**
 * 1stOne F1 — JWT verification for edge functions.
 *
 * Every edge function is deployed with --no-verify-jwt, so the Supabase
 * gateway does NOT validate the caller's token. This module is therefore the
 * auth boundary: getUserFromJwt verifies the token's ES256 signature against
 * the project's published JWKS before any claim is trusted. A forged,
 * tampered, unsigned, or expired token resolves to null and the caller
 * returns 401.
 *
 * Local verification against a cached JWKS is used rather than a per-request
 * call to the auth server — it adds no network hop to the hot path, and jose
 * handles key fetching, caching, and rotation. The JWKS endpoint is public.
 *
 * NOTE: getUserFromJwt is async. Every caller must `await` it.
 */

import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

// Project JWKS — the public EC keys GoTrue signs access tokens with. Created
// once per isolate; jose fetches lazily on the first verify, caches the
// result, and refreshes automatically on key rotation.
const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

export interface JwtUser {
  id: string;
  phone?: string;
}

/**
 * Verify a Supabase access token and return the authenticated user.
 * Returns null for ANY invalid token — bad signature, wrong key, expired,
 * malformed, or empty. Never throws.
 *
 * `algorithms: ['ES256']` pins the signature algorithm so a token cannot
 * downgrade the check (alg-confusion / 'none' attacks). jwtVerify also
 * enforces `exp` / `nbf` automatically.
 */
export async function getUserFromJwt(jwt: string): Promise<JwtUser | null> {
  if (!jwt) return null;
  try {
    const { payload } = await jwtVerify(jwt, JWKS, { algorithms: ['ES256'] });
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      phone: typeof payload.phone === 'string' ? payload.phone : undefined,
    };
  } catch {
    // Invalid signature / expired / malformed — reject.
    return null;
  }
}
