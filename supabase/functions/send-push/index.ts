/**
 * 1stOne F1 — Send Push (Edge Function)
 *
 * Generic push-notification sender. Takes a list of user_ids OR a role
 * filter, looks up their active push tokens, and fans out via Expo's
 * push API.
 *
 * Body shape:
 *   {
 *     user_ids?: string[],          // explicit targets
 *     role?: 'staff' | 'admin' | 'customer',  // broad targets
 *     branch_id?: number,           // narrow role-based targets
 *     title: string,
 *     body: string,
 *     data?: Record<string, any>,   // deep-link payload: { screen, params }
 *   }
 *
 * Response: { sent: number, failed: number, invalid_tokens: string[] }
 *
 * SECURITY: This function requires the service-role key in the Authorization
 * header (internal callers only — pg_net or another Edge Function). Customer
 * clients MUST NOT call this directly.
 *
 * Deploy: supabase functions deploy send-push --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type ExpoTicket = { status: 'ok' | 'error'; id?: string; message?: string; details?: any };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // Require the service-role key to call this function — internal only.
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.replace('Bearer ', '').trim();
    if (token !== SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const { user_ids, role, branch_id, title, body: msgBody, data } = body ?? {};

    if (!title || !msgBody) {
      return json({ error: 'title and body are required' }, 400);
    }

    // ── Resolve target user ids ─────────────────────────────────
    let targetIds: string[] = Array.isArray(user_ids) ? user_ids.filter(Boolean) : [];

    if ((targetIds.length === 0) && role) {
      let q = supabase.from('profiles').select('id').eq('role', role);
      if (typeof branch_id === 'number') q = q.eq('branch_id', branch_id);
      const { data: rows, error } = await q;
      if (error) throw error;
      targetIds = (rows ?? []).map((r: any) => r.id);
    }

    if (targetIds.length === 0) {
      return json({ sent: 0, failed: 0, invalid_tokens: [], reason: 'no targets' }, 200);
    }

    // ── Load active push tokens ─────────────────────────────────
    const { data: tokenRows, error: tokErr } = await supabase
      .from('push_notification_tokens')
      .select('token')
      .in('user_id', targetIds)
      .eq('is_active', true);
    if (tokErr) throw tokErr;

    const tokens = (tokenRows ?? []).map((t: any) => t.token).filter(Boolean);
    if (tokens.length === 0) {
      return json({ sent: 0, failed: 0, invalid_tokens: [], reason: 'no tokens' }, 200);
    }

    // ── Build messages (chunks of 100 per Expo docs) ───────────
    const messages = tokens.map((to: string) => ({
      to,
      sound: 'default',
      title,
      body: msgBody,
      data: data ?? {},
    }));

    const chunks: any[][] = [];
    for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));

    let sent = 0;
    let failed = 0;
    const invalidTokens: string[] = [];

    for (const chunk of chunks) {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      const payload = await res.json().catch(() => ({}));
      const tickets: ExpoTicket[] = payload?.data ?? [];
      tickets.forEach((t: ExpoTicket, idx: number) => {
        if (t.status === 'ok') {
          sent += 1;
        } else {
          failed += 1;
          const code = t.details?.error;
          if (code === 'DeviceNotRegistered') invalidTokens.push(chunk[idx].to);
        }
      });
    }

    // Deactivate invalid tokens so future pushes skip them
    if (invalidTokens.length > 0) {
      await supabase
        .from('push_notification_tokens')
        .update({ is_active: false })
        .in('token', invalidTokens);
    }

    return json({ sent, failed, invalid_tokens: invalidTokens }, 200);
  } catch (err: any) {
    console.error('[send-push] error', err);
    return json({ error: err.message ?? 'Internal server error' }, 500);
  }
});
