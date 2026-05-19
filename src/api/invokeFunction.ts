/**
 * 1stOne F1 — Shared edge-function caller.
 *
 * One place for the auth header + error handling that every
 * supabase.functions.invoke() call would otherwise repeat. On failure it
 * throws a clean Error carrying the server's message when available; on
 * success it returns the typed response body.
 *
 * Use this for edge functions whose contract is "succeed → data, fail →
 * throw". Calls with bespoke needs (idempotency keys, 409-drift branching,
 * fire-and-forget pushes) intentionally stay on supabase.functions.invoke
 * directly — forcing them through a generic wrapper would obscure that logic.
 */

import { supabase } from './supabaseClient';

interface InvokeOptions {
  /** Extra headers merged on top of the Authorization header. */
  headers?: Record<string, string>;
  /** Message shown when the server gave no parseable error of its own. */
  fallbackMessage?: string;
}

export async function invokeFunction<T>(
  name: string,
  body?: Record<string, unknown>,
  options?: InvokeOptions,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  // Every edge function this helper calls requires an authenticated user.
  // Fail fast with a clear message rather than a "Bearer undefined" → 401.
  if (!session) throw new Error('Not authenticated');
  const { data, error } = await supabase.functions.invoke(name, {
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      ...(options?.headers ?? {}),
    },
    body,
  });

  // A function may signal failure two ways: a transport/HTTP error, or an
  // HTTP 200 with an { error } body. Treat both as failure.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyError = data && typeof data === 'object' ? (data as any).error : undefined;
  if (error || bodyError) {
    let message = options?.fallbackMessage ?? 'Something went wrong. Please try again.';
    if (bodyError) {
      message = String(bodyError);
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctx = (error as any)?.context;
        if (ctx) {
          const text = await (ctx.clone ? ctx.clone() : ctx).text();
          const parsed = JSON.parse(text);
          if (parsed?.error) message = parsed.error;
        }
      } catch {
        /* keep the fallback message */
      }
    }
    throw new Error(message);
  }

  return data as T;
}
