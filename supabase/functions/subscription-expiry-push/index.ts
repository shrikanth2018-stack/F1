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
import { resolveAndSendPush } from '../_shared/notifications.ts';

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

    // Load all active, non-paused subscriptions with their plan's duration
    const { data: subs, error: subsErr } = await supabase
      .from('user_subscriptions')
      .select('id, user_id, start_date, days_consumed, subscription_plans!inner(plan_name, duration_days)')
      .eq('is_active', true)
      .eq('is_paused', false);

    if (subsErr) throw subsErr;

    type Bucket = { userId: string; subId: number; planName: string };
    const oneDay: Bucket[] = [];
    const twoDay: Bucket[] = [];
    const startingTomorrow: Bucket[] = [];

    const tomorrowStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
      .format(new Date(Date.now() + 86_400_000));

    for (const sub of subs ?? []) {
      const plan = sub.subscription_plans as any;
      if (!plan?.duration_days || !sub.start_date) continue;

      // Starts-tomorrow: day before first delivery (heads-up push).
      if (sub.start_date === tomorrowStr) {
        startingTomorrow.push({ userId: sub.user_id, subId: sub.id, planName: plan.plan_name });
      }

      // BF-33 / F2.1: end-of-life is driven by days_consumed, not the
      // calendar. daysLeft counts unconsumed paid meals so heads-up
      // notifications fire on delivery proximity, not date proximity.
      const daysLeft = (plan.duration_days ?? 0) - ((sub as any).days_consumed ?? 0);

      if (daysLeft === 1) {
        oneDay.push({ userId: sub.user_id, subId: sub.id, planName: plan.plan_name });
      } else if (daysLeft === 2) {
        twoDay.push({ userId: sub.user_id, subId: sub.id, planName: plan.plan_name });
      }
    }

    const results: any[] = [];

    // ── Send starts-tomorrow notices (heads-up the day before first delivery) ──
    for (const { userId, subId, planName } of startingTomorrow) {
      const r = await resolveAndSendPush({
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
        eventKey: 'subscription.starting_tomorrow',
        userIds: [userId],
        vars: { plan_name: planName },
        fallback: {
          title: 'Subscription Starts Tomorrow',
          body: `Your ${planName} subscription starts tomorrow. First delivery on the way!`,
        },
        data: { screen: 'Subscriptions' },
        referenceId: String(subId),
      });
      results.push({ subId, phase: 'starting_tomorrow', ...r });
    }

    // ── Send 1-day notices ──────────────────────────────────────
    for (const { userId, subId, planName } of oneDay) {
      const r = await resolveAndSendPush({
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
        eventKey: 'subscription.ending_1d',
        userIds: [userId],
        vars: { plan_name: planName },
        fallback: {
          title: 'Subscription Ending Tomorrow',
          body: `Your ${planName} subscription ends tomorrow. Renew now to stay uninterrupted!`,
        },
        data: { screen: 'PlanDetail', params: { subscriptionId: subId } },
        referenceId: String(subId),
      });
      results.push({ subId, daysLeft: 1, ...r });
    }

    // ── Send 2-day notices ──────────────────────────────────────
    for (const { userId, subId, planName } of twoDay) {
      const r = await resolveAndSendPush({
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
        eventKey: 'subscription.ending_2d',
        userIds: [userId],
        vars: { plan_name: planName },
        fallback: {
          title: 'Subscription Ending in 2 Days',
          body: `Your ${planName} subscription ends in 2 days. Renew now to keep your meals coming!`,
        },
        data: { screen: 'PlanDetail', params: { subscriptionId: subId } },
        referenceId: String(subId),
      });
      results.push({ subId, daysLeft: 2, ...r });
    }

    console.log(
      `[subscription-expiry-push] ${todayStr}: ${startingTomorrow.length} × starts-tomorrow, ${oneDay.length} × 1-day, ${twoDay.length} × 2-day notices sent`,
    );
    return json({
      date: todayStr,
      starting_tomorrow: startingTomorrow.length,
      one_day: oneDay.length,
      two_day: twoDay.length,
      results,
    });

  } catch (err: any) {
    console.error('[subscription-expiry-push] error:', err?.message);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
