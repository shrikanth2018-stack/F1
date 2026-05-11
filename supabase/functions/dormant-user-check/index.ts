/**
 * 1stOne F1 — Dormant User Check (Edge Function / Cron)
 *
 * Blueprint Sec 5.5 — marketing/win-back.
 * Runs weekly (Monday 10:00 IST / 04:30 UTC Monday) via pg_cron.
 * Finds customers whose last order created_at is older than
 * store_config.winback_inactive_days (default 14). Sends a gentle re-engagement push.
 *
 * Does not double-send: skips anyone who already received a dormant push in the last
 * {winback_inactive_days} days (tracked via push_logs or analogous, else just fires
 * weekly which is acceptable cadence).
 *
 * Deploy: supabase functions deploy dormant-user-check --no-verify-jwt
 *
 * Schedule (run in Supabase SQL editor):
 *   select cron.schedule(
 *     'dormant-user-check',
 *     '30 4 * * 1',
 *     $$ select net.http_post(
 *          url     := current_setting('app.supabase_url', true) || '/functions/v1/dormant-user-check',
 *          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key', true)),
 *          body    := '{}'::jsonb
 *        ); $$
 *   );
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { resolveAndSendPush } from '../_shared/notifications.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  const auth = req.headers.get('Authorization') ?? '';
  if (auth.replace('Bearer ', '').trim() !== SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: config } = await supabase
      .from('store_config')
      .select('winback_inactive_days')
      .limit(1)
      .maybeSingle();
    const inactiveDays: number = (config as any)?.winback_inactive_days ?? 14;

    // Cutoff: anyone whose latest order is older than this date (or who has no orders) qualifies.
    const cutoffIso = new Date(Date.now() - inactiveDays * 86_400_000).toISOString();

    // Find customers — skip admin/staff.
    // We fetch recent orders per user to get "most recent order time" server-side.
    const { data: recentOrders, error: ordErr } = await supabase
      .from('orders')
      .select('user_id, created_at')
      .gte('created_at', cutoffIso);
    if (ordErr) throw ordErr;

    const activeRecently = new Set<string>();
    for (const o of recentOrders ?? []) {
      if ((o as any).user_id) activeRecently.add((o as any).user_id);
    }

    // Pull customer profiles; exclude anyone with a recent order.
    const { data: allProfiles, error: profErr } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('role', 'customer');
    if (profErr) throw profErr;

    let candidates = (allProfiles ?? [])
      .filter((p) => !activeRecently.has((p as any).id))
      .map((p) => (p as any).id as string);

    // BF-40 (F7.2): honor the header comment's "won't double-send" promise.
    // Previously the body never read push_logs, so a 30+-day dormant user
    // got a winback push every Monday. Now: skip anyone who already received
    // a winback in the last `inactiveDays` days.
    if (candidates.length > 0) {
      const { data: recentWinbacks } = await supabase
        .from('push_logs')
        .select('user_id')
        .eq('trigger_source', 'winback')
        .gte('sent_at', cutoffIso)
        .in('user_id', candidates);
      const alreadyPushed = new Set(
        (recentWinbacks ?? []).map((r: any) => r.user_id).filter(Boolean),
      );
      candidates = candidates.filter((id) => !alreadyPushed.has(id));
    }

    if (candidates.length === 0) {
      return json({ fired: 0, inactiveDays });
    }

    // Fire in small batches so one push endpoint doesn't get hammered.
    const BATCH = 50;
    const results: any[] = [];
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      const r = await resolveAndSendPush({
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
        eventKey: 'winback.dormant',
        userIds: batch,
        fallback: {
          title: "We've missed you",
          body: 'Your next meal is just a tap away. Come see what’s fresh today.',
        },
        data: { screen: 'Home' },
      });
      results.push({ batch_size: batch.length, ...r });
    }

    console.log(`[dormant-user-check] fired=${candidates.length}, inactiveDays=${inactiveDays}`);
    return json({ fired: candidates.length, inactiveDays, results });

  } catch (err: any) {
    console.error('[dormant-user-check] error:', err?.message);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
