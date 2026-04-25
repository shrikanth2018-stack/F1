/**
 * 1stOne F1 — Shared notification template resolver.
 *
 * Every edge function that fires a push notification calls `resolveAndSendPush`
 * with a stable event_key. The helper:
 *   1. Looks up the matching row in notification_templates.
 *   2. If the row exists and is_enabled=false → returns silently (admin toggled off).
 *   3. If the row is missing → uses the fallback title/body provided by the caller.
 *   4. Substitutes {{variable}} placeholders.
 *   5. Posts to /functions/v1/send-push with the resolved title/body.
 *
 * Keeps hardcoded fallbacks in each caller so nothing breaks if the templates
 * table is empty. Admin can customize text or disable events without any
 * code push, per Phase 2 of blueprint Sec 5.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export interface ResolveAndSendArgs {
  supabase: SupabaseClient;
  supabaseUrl: string;
  serviceRoleKey: string;
  eventKey: string;
  userIds: string[];
  vars?: Record<string, string | number | null | undefined>;
  fallback: { title: string; body: string };
  data?: Record<string, unknown>;
  referenceId?: string;
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
 * Resolves a notification template and dispatches the push.
 * Silently no-ops (returns { skipped: true }) when the template is disabled.
 * Never throws — logs errors so a misconfigured template can't take down a flow.
 */
export async function resolveAndSendPush(args: ResolveAndSendArgs): Promise<{
  status: 'sent' | 'skipped' | 'error';
  detail?: string;
}> {
  const { supabase, supabaseUrl, serviceRoleKey, eventKey, userIds, vars = {}, fallback, data, referenceId } = args;

  if (!userIds || userIds.length === 0) return { status: 'skipped', detail: 'no recipients' };

  let title = fallback.title;
  let body = fallback.body;
  let triggerSource: string | undefined;

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
      triggerSource = tmpl.trigger_source ?? undefined;
    }
  } catch (e) {
    // Templates table unreachable (e.g. not yet migrated) — proceed with fallback.
    console.error(`[notifications] template lookup failed for ${eventKey}:`, (e as Error).message);
  }

  // Substitute {{vars}} in final strings
  title = substitute(title, vars);
  body  = substitute(body,  vars);

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        user_ids: userIds,
        title,
        body,
        data: data ?? {},
        trigger_source: triggerSource ?? 'unknown',
        reference_id: referenceId,
      }),
    });

    if (!res.ok) {
      const detail = `send-push returned ${res.status}`;
      console.error(`[notifications] ${eventKey}: ${detail}`);
      return { status: 'error', detail };
    }
    return { status: 'sent' };
  } catch (e) {
    const detail = (e as Error).message;
    console.error(`[notifications] ${eventKey} push dispatch failed:`, detail);
    return { status: 'error', detail };
  }
}
