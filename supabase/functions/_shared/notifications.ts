/**
 * 1stOne F1 — Shared notification template resolver + push dispatcher.
 *
 * Every edge function that fires a push notification calls `resolveAndSendPush`
 * with a stable event_key. The helper:
 *   1. Looks up the matching row in notification_templates.
 *   2. If the row exists and is_enabled=false → returns silently (admin toggled off).
 *   3. If the row is missing → uses the fallback title/body provided by the caller.
 *   4. Substitutes {{variable}} placeholders.
 *   5. Dispatches the push DIRECTLY via Expo using the caller's service-role
 *      Supabase client — queries push_notification_tokens, POSTs to Expo,
 *      writes push_logs, deactivates dead tokens.
 *
 * Why direct (not an HTTP call to the send-push function): function-to-function
 * calls re-authenticate with a `token === SUPABASE_SERVICE_ROLE_KEY` string
 * compare in send-push. Across the project's API-key-system migration that
 * handshake breaks (send-push 401s the caller) — proven 2026-05-16. The caller
 * already holds a working service-role client (it writes the order with it),
 * so we use it directly and skip the fragile hop entirely.
 *
 * The standalone `send-push` Edge Function is unchanged — it still serves the
 * client/staff-JWT path (useUpdateOrderStatus, useAdminOrders.firePush).
 *
 * The dispatch runs as a background task registered via EdgeRuntime.waitUntil:
 * Supabase Edge kills un-awaited promises the instant the handler returns its
 * Response. Callers fire `resolveAndSendPush` without awaiting; the helper
 * makes that safe.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface ResolveAndSendArgs {
  supabase: SupabaseClient;
  /** Unused since 2026-05-16 (kept for caller compatibility — no HTTP hop). */
  supabaseUrl?: string;
  /** Unused since 2026-05-16 (kept for caller compatibility — no HTTP hop). */
  serviceRoleKey?: string;
  eventKey: string;
  userIds: string[];
  vars?: Record<string, string | number | null | undefined>;
  fallback: { title: string; body: string };
  data?: Record<string, unknown>;
  referenceId?: string;
}

/**
 * Keeps the Edge isolate alive until a fire-and-forget promise settles.
 * Supabase Edge kills un-awaited promises the moment the handler returns its
 * Response; EdgeRuntime.waitUntil lets the task finish in the background.
 */
export function runAfterResponse(p: Promise<unknown>): void {
  try {
    // @ts-ignore — EdgeRuntime is a Supabase Edge runtime global
    if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
      // @ts-ignore
      EdgeRuntime.waitUntil(p);
    }
  } catch {
    /* not on the Edge runtime — the promise still runs best-effort */
  }
}

/** Simple {{var}} substitution — missing keys render as empty string. */
function substitute(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    if (v === null || v === undefined) return '';
    return String(v);
  });
}

/**
 * Resolves the template, then dispatches the push directly via Expo using the
 * caller's service-role client. Never throws — logs errors so a misconfigured
 * template or token row can't take down a flow.
 */
async function doResolveAndSend(args: ResolveAndSendArgs): Promise<{
  status: 'sent' | 'skipped' | 'error';
  detail?: string;
}> {
  const { supabase, eventKey, userIds, vars = {}, fallback, data, referenceId } = args;

  if (!userIds || userIds.length === 0) return { status: 'skipped', detail: 'no recipients' };

  // ── Resolve template ────────────────────────────────────────
  let title = fallback.title;
  let body = fallback.body;
  let triggerSource = 'unknown';

  try {
    const { data: tmpl } = await supabase
      .from('notification_templates')
      .select('title_template, body_template, is_enabled, trigger_source')
      .eq('event_key', eventKey)
      .maybeSingle();

    if (tmpl) {
      if (tmpl.is_enabled === false) {
        return { status: 'skipped', detail: 'template disabled' };
      }
      title = tmpl.title_template ?? title;
      body  = tmpl.body_template  ?? body;
      triggerSource = tmpl.trigger_source ?? triggerSource;
    }
  } catch (e) {
    // Templates table unreachable — proceed with fallback.
    console.error(`[notifications] template lookup failed for ${eventKey}:`, (e as Error).message);
  }

  title = substitute(title, vars);
  body  = substitute(body,  vars);

  // ── Dispatch directly via Expo (no function-to-function hop) ──
  try {
    const { data: tokenRows, error: tokErr } = await supabase
      .from('push_notification_tokens')
      .select('token, user_id')
      .in('user_id', userIds)
      .eq('is_active', true);

    if (tokErr) {
      console.error(`[notifications] ${eventKey} token query failed:`, tokErr.message);
      return { status: 'error', detail: tokErr.message };
    }

    const tokenUserMap = new Map<string, string>(
      (tokenRows ?? []).map((t: any) => [t.token, t.user_id]),
    );
    const tokens = [...tokenUserMap.keys()].filter(Boolean);
    if (tokens.length === 0) return { status: 'skipped', detail: 'no active tokens' };

    const messages = tokens.map((to: string) => ({
      to,
      sound: 'default',
      title,
      body,
      data: data ?? {},
    }));

    const invalidTokens: string[] = [];
    const logRows: any[] = [];

    // Expo accepts up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      let tickets: any[] = [];
      try {
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
        tickets = payload?.data ?? [];
      } catch (e) {
        console.error(`[notifications] ${eventKey} Expo POST failed:`, (e as Error).message);
      }

      chunk.forEach((msg, idx) => {
        const ticket = tickets[idx] ?? {};
        const isOk = ticket.status === 'ok';
        const errorCode = ticket.details?.error;
        if (errorCode === 'DeviceNotRegistered') invalidTokens.push(msg.to);
        logRows.push({
          user_id: tokenUserMap.get(msg.to) ?? null,
          token: msg.to,
          title,
          body,
          data: data ?? {},
          trigger_source: triggerSource,
          reference_id: referenceId ? String(referenceId) : null,
          expo_ticket_id: ticket.id ?? null,
          status: isOk ? 'sent' : (errorCode === 'DeviceNotRegistered' ? 'invalid_token' : 'failed'),
          error_message: ticket.message ?? null,
        });
      });
    }

    // Deactivate tokens Expo reported as dead.
    if (invalidTokens.length > 0) {
      await supabase
        .from('push_notification_tokens')
        .update({ is_active: false })
        .in('token', invalidTokens);
    }

    // Audit log — every attempt, success or failure.
    if (logRows.length > 0) {
      const { error: logErr } = await supabase.from('push_logs').insert(logRows);
      if (logErr) console.error('[notifications] push_logs insert failed:', logErr.message);
    }

    return { status: 'sent' };
  } catch (e) {
    const detail = (e as Error).message;
    console.error(`[notifications] ${eventKey} push dispatch failed:`, detail);
    return { status: 'error', detail };
  }
}

/**
 * Resolves a notification template and dispatches the push as a background
 * task that survives the handler returning its Response. Callers fire it
 * without awaiting; returns immediately. Never throws.
 */
export function resolveAndSendPush(args: ResolveAndSendArgs): Promise<{ status: string }> {
  const work = doResolveAndSend(args).catch((e) => {
    console.error('[notifications] push dispatch crashed:', (e as Error)?.message);
    return { status: 'error' as const };
  });
  runAfterResponse(work);
  return Promise.resolve({ status: 'scheduled' });
}
