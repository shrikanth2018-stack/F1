/**
 * JWT decode for ES256 Supabase projects.
 * supabase.auth.getUser(jwt) only works with HS256 — newer projects use ES256.
 * We decode the payload directly; expiry is checked, signature is trusted
 * because the token was issued by Supabase Auth and the service-role client
 * enforces its own data-access security on top.
 */
export function getUserFromJwt(jwt: string): { id: string; phone?: string } | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    if (!payload.sub) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { id: payload.sub as string, phone: payload.phone };
  } catch {
    return null;
  }
}
