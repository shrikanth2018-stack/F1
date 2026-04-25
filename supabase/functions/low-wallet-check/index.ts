/**
 * 1stOne F1 — Low Wallet Check (Edge Function / Cron)
 *
 * Blueprint Sec 5.5 — financial warning.
 * Runs daily (09:30 IST / 04:00 UTC) via pg_cron.
 * Finds users with an active subscription renewing in the next 2 days AND
 * wallet balance below the admin-configurable threshold. Sends a push
 * prompting them to top up before auto-renewal.
 *
 * Deploy: supabase functions deploy low-wallet-check --no-verify-jwt
 *
 * Schedule (run in Supabase SQL editor):
 *   select cron.schedule(
 *     'low-wallet-check',
 *     '0 4 * * *',
 *     $$ select net.http_post(
 *          url     := current_setting('app.supabase_url', true) || '/functions/v1/low-wallet-check',
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

    // Admin-configurable threshold; fallback ₹200.
    const { data: config } = await supabase
      .from('store_config')
      .select('low_wallet_threshold')
      .limit(1)
      .maybeSingle();
    const threshold: number = (config as any)?.low_wallet_threshold ?? 200;

    // Active, non-paused subs with their plan price + user wallet balance.
    const { data: subs, error: subsErr } = await supabase
      .from('user_subscriptions')
      .select('id, user_id, start_date, subscription_plans!inner(plan_name, duration_days, price)')
      .eq('is_active', true)
      .eq('is_paused', false);
    if (subsErr) throw subsErr;

    const todayMs = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()) + 'T00:00:00Z').getTime();

    // Find subs ending in the next 2 days (candidates for renewal warning).
    const candidates: Array<{ userId: string; planName: string; price: number; subId: number }> = [];
    for (const sub of subs ?? []) {
      const plan = (sub as any).subscription_plans;
      if (!plan?.duration_days || !sub.start_date) continue;
      const endMs = new Date(sub.start_date + 'T00:00:00Z').getTime() + plan.duration_days * 86_400_000;
      const daysLeft = Math.round((endMs - todayMs) / 86_400_000);
      if (daysLeft === 1 || daysLeft === 2) {
        candidates.push({ userId: sub.user_id, planName: plan.plan_name, price: plan.price ?? 0, subId: sub.id });
      }
    }

    if (candidates.length === 0) {
      return json({ warned: 0, threshold });
    }

    // Look up wallet balances for candidate users in one query.
    const userIds = Array.from(new Set(candidates.map((c) => c.userId)));
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, wallet_balance')
      .in('id', userIds);
    const balanceById = new Map<string, number>();
    for (const p of profiles ?? []) balanceById.set((p as any).id, Number((p as any).wallet_balance ?? 0));

    let warned = 0;
    const results: any[] = [];
    for (const c of candidates) {
      const balance = balanceById.get(c.userId) ?? 0;
      if (balance >= threshold) continue;

      const shortfall = Math.max(0, c.price - balance);
      const r = await resolveAndSendPush({
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
        eventKey: 'wallet.low_balance',
        userIds: [c.userId],
        vars: { shortfall: Math.ceil(shortfall), plan_name: c.planName },
        fallback: {
          title: 'Low Wallet Balance',
          body: `Top up ₹${Math.ceil(shortfall)} before your ${c.planName} subscription auto-renews.`,
        },
        data: { screen: 'Wallet' },
        referenceId: String(c.subId),
      });
      warned += 1;
      results.push({ subId: c.subId, ...r });
    }

    console.log(`[low-wallet-check] ${warned} users warned (threshold=${threshold})`);
    return json({ warned, threshold, results });

  } catch (err: any) {
    console.error('[low-wallet-check] error:', err?.message);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
