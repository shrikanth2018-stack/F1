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

/** Result of a send-push call — null when the send failed or was skipped. */
export interface SendPushResult {
  sent: number;
  failed: number;
}

/**
 * Sends a push via the `send-push` Edge Function using the current user's
 * JWT. Fire-and-forget — awaiting is optional, and it never throws.
 * Returns {sent, failed} on success (used by the admin custom-push
 * composer for feedback); null on any failure.
 */
export async function sendPush(body: SendPushBody): Promise<SendPushResult | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    const { data, error } = await supabase.functions.invoke('send-push', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body,
    });
    if (error) {
      console.error('[sendPush]', error);
      return null;
    }
    return {
      sent: Number(data?.sent ?? 0),
      failed: Number(data?.failed ?? 0),
    };
  } catch (e) {
    console.error('[sendPush]', e);
    return null;
  }
}
