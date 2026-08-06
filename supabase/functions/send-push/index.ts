/**
 * 1stOne F1 — Send Push (Edge Function)
 *
 * Generic push-notification sender. Takes a list of user_ids OR a role
 * filter, looks up their active push tokens, and fans out via Expo's
 * push API. Logs every attempt to push_logs for auditing.
 *
 * Body shape:
 *   {
 *     user_ids?:       string[],
 *     role?:           'staff' | 'admin' | 'customer',
 *     branch_id?:      number,
 *     title:           string,
 *     body:            string,
 *     data?:           Record<string, any>,     // deep-link payload
 *     trigger_source?: string,                  // 'order_status' | 'subscription_expiry' | 'admin_push'
 *     reference_id?:   string,                  // order_id, subscription_id, etc.
 *   }
 *
 * Response: { sent: number, failed: number, invalid_tokens: string[] }
 *
 * SECURITY: Requires the service-role key in Authorization header.
 * Customer clients MUST NOT call this directly — only pg_net or another
 * Edge Function may call it.
 *
 * Deploy: supabase functions deploy send-push --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';
import { isAllowedOrigin } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SUPABASE_PROJECT_URL = SUPABASE_URL;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type ExpoTicket = { status: 'ok' | 'error'; id?: string; message?: string; details?: any };

Deno.serve(async (req) => {
  // ── CORS ────────────────────────────────────────────────────
  const origin = req.headers.get('Origin') ?? '';
  const acao = isAllowedOrigin(origin) ? origin : SUPABASE_PROJECT_URL;
  const cors = {
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Auth: accept service-role key (internal/edge-function callers)
    // OR a staff/admin user JWT (hooks calling after status update)
    // OR a hub-operator JWT (role='customer' + assigned_hub_id, performs
    // staff-like status transitions on hub-routed orders → must be able
    // to fire order.delivered push to the customer).
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.replace('Bearer ', '').trim();
    let authorized = token === SUPABASE_SERVICE_ROLE_KEY;

    // D5: pg_net callers (daily manifest, cron-failure alert) send the
    // service-role key stored in app_config. Accept that value too — so a
    // key drifting between the function env and app_config (which happened
    // across the API-key migration) can't silently 401 internal pushes.
    if (!authorized && token) {
      const { data: cfg } = await supabase
        .from('app_config').select('value').eq('key', 'service_role_key').maybeSingle();
      if (cfg?.value && token === cfg.value) authorized = true;
    }

    if (!authorized && token) {
      const caller = await getUserFromJwt(token);
      if (caller) {
        const { data: profile } = await supabase
          .from('profiles').select('role, assigned_hub_id').eq('id', caller.id).maybeSingle();
        authorized =
          profile?.role === 'staff' ||
          profile?.role === 'admin' ||
          (profile?.role === 'customer' && profile?.assigned_hub_id != null);
      }
    }

    if (!authorized) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json();
    const {
      user_ids,
      role,
      branch_id,
      title: titleIn,
      body: msgBody,
      event_key,
      vars: varsIn,
      data,
      trigger_source: triggerSourceIn = 'unknown',
      reference_id = null,
    } = body ?? {};

    // ── Template resolution (optional) ──────────────────────────
    // If event_key is given, look up notification_templates for title/body.
    // is_enabled=false → skip entirely (return 200, sent=0 skipped).
    // missing row → fall through to the caller-provided title/body.
    let title: string | undefined = titleIn;
    let resolvedBody: string | undefined = msgBody;
    let trigger_source: string = triggerSourceIn;

    if (event_key) {
      const { data: tmpl } = await supabase
        .from('notification_templates')
        .select('title_template, body_template, is_enabled, trigger_source')
        .eq('event_key', event_key)
        .maybeSingle();
      if (tmpl) {
        if (tmpl.is_enabled === false) {
          return json({ sent: 0, skipped: true, reason: 'template_disabled' });
        }
        const vars: Record<string, unknown> = (varsIn && typeof varsIn === 'object') ? varsIn : {};
        const substitute = (tpl: string) =>
          tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
            const v = vars[k];
            return v === null || v === undefined ? '' : String(v);
          });
        title        = substitute(tmpl.title_template);
        resolvedBody = substitute(tmpl.body_template);
        trigger_source = tmpl.trigger_source ?? trigger_source;
      }
    }

    if (!title || !resolvedBody) {
      return json({ error: 'title and body (or a valid event_key) are required' }, 400);
    }

    // ── Resolve target user IDs ─────────────────────────────────
    let targetIds: string[] = Array.isArray(user_ids) ? user_ids.filter(Boolean) : [];

    if (targetIds.length === 0 && role) {
      let q = supabase.from('profiles').select('id').eq('role', role);
      if (typeof branch_id === 'number') q = q.eq('branch_id', branch_id);
      const { data: rows, error } = await q;
      if (error) throw error;
      targetIds = (rows ?? []).map((r: any) => r.id);
    }

    if (targetIds.length === 0) {
      return json({ sent: 0, failed: 0, invalid_tokens: [], reason: 'no targets' }, 200);
    }

    // ── Load active push tokens (with user_id for logging) ─────
    const { data: tokenRows, error: tokErr } = await supabase
      .from('push_notification_tokens')
      .select('token, user_id')
      .in('user_id', targetIds)
      .eq('is_active', true);
    if (tokErr) throw tokErr;

    const tokenUserMap = new Map<string, string>(
      (tokenRows ?? []).map((t: any) => [t.token, t.user_id]),
    );
    const tokens = [...tokenUserMap.keys()].filter(Boolean);

    if (tokens.length === 0) {
      return json({ sent: 0, failed: 0, invalid_tokens: [], reason: 'no tokens' }, 200);
    }

    // ── Build messages (chunks of 100 per Expo docs) ───────────
    const messages = tokens.map((to: string) => ({
      to,
      sound: 'default',
      title,
      body: resolvedBody,
      data: data ?? {},
    }));

    const chunks: any[][] = [];
    for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));

    let sent = 0;
    let failed = 0;
    const invalidTokens: string[] = [];
    const logRows: any[] = [];

    // ── Fan out via Expo ────────────────────────────────────────
    //
    // EVERY CHUNK IS ISOLATED. This fetch used to be unguarded, so a
    // network-layer throw — DNS failure, the 15s AbortSignal firing, a
    // connection reset — jumped straight to the handler at the bottom of this
    // function, skipping the remaining chunks, the dead-token cleanup AND the
    // push_logs insert. The push then failed leaving no evidence at all, on
    // the one table you would look at to find out why nobody got it.
    //
    // That is not hypothetical here: the kitchen batch push spent months
    // pointing at a placeholder hostname from an unprovisioned Vault, and
    // push_logs was empty throughout — which read as "no pushes were ever
    // attempted" rather than "every one of them failed".
    //
    // _shared/notifications.ts already got this right; this is the same
    // treatment. A failed chunk records one 'failed' row per recipient and
    // the loop carries on, so one bad batch cannot silence the rest.
    for (const chunk of chunks) {
      let tickets: ExpoTicket[] = [];
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          // Bounded — an Expo stall must not hang the cron/status-update caller (#10).
          signal: AbortSignal.timeout(15_000),
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chunk),
        });
        const payload = await res.json().catch(() => ({}));
        tickets = payload?.data ?? [];
      } catch (e) {
        const detail = (e as Error)?.message ?? String(e);
        console.error('[send-push] Expo POST failed:', detail);
        for (const msg of chunk) {
          failed += 1;
          logRows.push({
            user_id: tokenUserMap.get(msg.to) ?? null,
            token: msg.to,
            title,
            body: resolvedBody,
            data: data ?? {},
            trigger_source,
            reference_id: reference_id ? String(reference_id) : null,
            expo_ticket_id: null,
            status: 'failed',
            error_message: detail,
          });
        }
        continue;
      }

      tickets.forEach((t: ExpoTicket, idx: number) => {
        const token = chunk[idx].to;
        const userId = tokenUserMap.get(token) ?? null;
        const isOk = t.status === 'ok';
        const errorCode = t.details?.error;

        if (isOk) {
          sent += 1;
        } else {
          failed += 1;
          if (errorCode === 'DeviceNotRegistered') invalidTokens.push(token);
        }

        logRows.push({
          user_id: userId,
          token,
          title,
          body: resolvedBody,
          data: data ?? {},
          trigger_source,
          reference_id: reference_id ? String(reference_id) : null,
          expo_ticket_id: t.id ?? null,
          status: isOk ? 'sent' : (errorCode === 'DeviceNotRegistered' ? 'invalid_token' : 'failed'),
          error_message: t.message ?? null,
        });
      });
    }

    // ── Deactivate invalid tokens ───────────────────────────────
    if (invalidTokens.length > 0) {
      await supabase
        .from('push_notification_tokens')
        .update({ is_active: false })
        .in('token', invalidTokens);
    }

    // ── Write push_logs (fire-and-forget, don't fail on log error) ─
    if (logRows.length > 0) {
      const { error: logErr } = await supabase.from('push_logs').insert(logRows);
      if (logErr) {
        console.error('[send-push] push_logs insert failed:', logErr.message);
      }
    }

    return json({ sent, failed, invalid_tokens: invalidTokens }, 200);
  } catch (err: any) {
    console.error('[send-push] error', err);
    return json({ error: err.message ?? 'Internal server error' }, 500);
  }
});
