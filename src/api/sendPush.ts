/**
 * 1stOne F1 — Shared client-side push sender (audit O4).
 *
 * The single chokepoint for the client → `send-push` Edge Function path.
 * Three callers — order-status pushes, the special-offer banner, and Note
 * to Staff — each hand-rolled getSession() + the Authorization header +
 * functions.invoke('send-push') + a catch. They now all route through here.
 *
 * Fire-and-forget: never throws — a push failure must not break the flow
 * that triggered it — and no-ops silently when there is no session.
 *
 * (The server-side push path — edge function → Expo → push_logs — is
 * already consolidated in supabase/functions/_shared/notifications.ts.)
 */

import { supabase } from './supabaseClient';

export interface SendPushBody {
  /** Explicit recipients. Used instead of `role` when targeting known users. */
  user_ids?: string[];
  /** Audience by role, when no explicit user_ids are given. */
  role?: 'staff' | 'admin' | 'customer';
  /** notification_templates lookup key — server resolves copy + on/off state. */
  event_key?: string;
  /** {{var}} substitutions applied to the resolved template. */
  vars?: Record<string, string | number | null | undefined>;
  /** Fallback title/body used when no template row matches the event_key. */
  title: string;
  body: string;
  /** Deep-link payload, e.g. { screen: 'OrderDetail', params: { orderId } }. */
  data?: Record<string, unknown>;
  trigger_source?: string;
  reference_id?: string;
}

/**
 * Sends a push via the `send-push` Edge Function using the current user's
 * JWT. Fire-and-forget — awaiting is optional, and it never throws.
 */
export async function sendPush(body: SendPushBody): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await supabase.functions.invoke('send-push', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body,
    });
  } catch (e) {
    console.error('[sendPush]', e);
  }
}
