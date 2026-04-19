/**
 * 1stOne F1 — Subscription Expiry Push (Edge Function / Cron)
 *
 * Runs daily at 09:00 IST (03:30 UTC) via pg_cron.
 * Finds active subscriptions ending in exactly 1 or 2 days and sends
 * a heads-up push notification to the subscriber.
 *
 * Deploy: supabase functions deploy subscription-expiry-push --no-verify-jwt
 *
 * Schedule (run in Supabase SQL editor):
 *   select cron.schedule(
 *     'subscription-expiry-push',
 *     '30 3 * * *',
 *     $$ select net.http_post(
 *          url     := current_setting('app.supabase_url', true) || '/functions/v1/subscription-expiry-push',
 *          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key', true)),
 *          body    := '{}'::jsonb
 *        ); $$
 *   );
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Returns today's date string in IST as YYYY-MM-DD */
function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  // Internal-only: require service-role key
  const auth = req.headers.get('Authorization') ?? '';
  if (auth.replace('Bearer ', '').trim() !== SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Anchor to today's IST date (DST-safe)
    const todayStr = todayIST();
    const todayMs = new Date(todayStr + 'T00:00:00Z').getTime();

    // Load all active, non-paused subscriptions with their plan's duration
    const { data: subs, error: subsErr } = await supabase
      .from('user_subscriptions')
      .select('id, user_id, start_date, subscription_plans!inner(plan_name, duration_days)')
      .eq('is_active', true)
      .eq('is_paused', false);

    if (subsErr) throw subsErr;

    type ExpiryBucket = { userId: string; subId: number; planName: string; daysLeft: number };
    const oneDay: ExpiryBucket[] = [];
    const twoDay: ExpiryBucket[] = [];

    for (const sub of subs ?? []) {
      const plan = sub.subscription_plans as any;
      if (!plan?.duration_days || !sub.start_date) continue;

      const endMs = new Date(sub.start_date + 'T00:00:00Z').getTime() + plan.duration_days * 86_400_000;
      const daysLeft = Math.round((endMs - todayMs) / 86_400_000);

      if (daysLeft === 1) {
        oneDay.push({ userId: sub.user_id, subId: sub.id, planName: plan.plan_name, daysLeft: 1 });
      } else if (daysLeft === 2) {
        twoDay.push({ userId: sub.user_id, subId: sub.id, planName: plan.plan_name, daysLeft: 2 });
      }
    }

    const results: any[] = [];

    // ── Send 1-day notices ──────────────────────────────────────
    for (const { userId, subId, planName } of oneDay) {
      const pushRes = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          user_ids: [userId],
          title: 'Subscription Ending Tomorrow',
          body: `Your ${planName} subscription ends tomorrow. Renew now to stay uninterrupted!`,
          data: { screen: 'PlanDetail', params: { subscriptionId: subId }, trigger_source: 'subscription_expiry' },
          trigger_source: 'subscription_expiry',
          reference_id: String(subId),
        }),
      });
      results.push({ subId, daysLeft: 1, status: pushRes.status });
    }

    // ── Send 2-day notices ──────────────────────────────────────
    for (const { userId, subId, planName } of twoDay) {
      const pushRes = await fetch(SUPABASE_URL + '/functions/v1/send-push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          user_ids: [userId],
          title: 'Subscription Ending in 2 Days',
          body: `Your ${planName} subscription ends in 2 days. Renew now to keep your meals coming!`,
          data: { screen: 'PlanDetail', params: { subscriptionId: subId }, trigger_source: 'subscription_expiry' },
          trigger_source: 'subscription_expiry',
          reference_id: String(subId),
        }),
      });
      results.push({ subId, daysLeft: 2, status: pushRes.status });
    }

    console.log(
      `[subscription-expiry-push] ${todayStr}: ${oneDay.length} × 1-day, ${twoDay.length} × 2-day notices sent`,
    );
    return json({ date: todayStr, one_day: oneDay.length, two_day: twoDay.length, results });

  } catch (err: any) {
    console.error('[subscription-expiry-push] error:', err?.message);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
