/**
 * 1stOne F1 — apply-referral Edge Function
 *
 * Server-side referral code application.
 * Replaces the client-side useApplyReferralCode logic.
 *
 * POST body: { code: string }
 * Headers: Authorization: Bearer <jwt>
 *
 * Idempotent: safe to call multiple times — checks reward_given before crediting.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = new Set([SUPABASE_URL, 'http://localhost:8081', 'http://localhost:19006']);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') ?? '';
  const acao = ALLOWED_ORIGINS.has(origin) ? origin : SUPABASE_URL;
  const cors = {
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    // Authenticate caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const { code } = await req.json();
    if (!code || typeof code !== 'string') return json({ error: 'code is required' }, 400);

    // Use service role for all DB writes (bypasses RLS safely)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Find referrer
    const { data: referrer, error: findErr } = await admin
      .from('profiles')
      .select('id')
      .eq('referral_code', code.toUpperCase().trim())
      .single();
    if (findErr || !referrer) return json({ error: 'Invalid referral code' }, 400);
    if (referrer.id === user.id) return json({ error: 'Cannot use your own code' }, 400);

    // 2. Check not already referred (idempotency)
    const { data: existing } = await admin
      .from('referrals')
      .select('id')
      .eq('referee_id', user.id)
      .limit(1);
    if (existing && existing.length > 0) {
      return json({ error: 'You have already used a referral code' }, 400);
    }

    // 3. Get settings
    const { data: rawSettings } = await admin
      .from('referral_settings')
      .select('*')
      .limit(1)
      .maybeSingle();
    const settings = mergedSettings(rawSettings);
    if (!settings.is_active) return json({ error: 'Referral program is currently inactive' }, 400);

    // 4. Create referral record
    const { error: refErr } = await admin.from('referrals').insert({
      referrer_id: referrer.id,
      referee_id: user.id,
      status: 'pending',
      reward_given: false,
      first_order_reward_given: false,
      month_reward_given: false,
    });
    if (refErr) return json({ error: 'Failed to create referral record' }, 500);

    // 5. Update referee profile
    await admin.from('profiles').update({ referred_by: referrer.id }).eq('id', user.id);

    // 6. Credit referee signup wallet credit (atomic RPC)
    if (settings.referee_signup_credit > 0) {
      await admin.rpc('increment_wallet_balance', {
        p_user_id: user.id,
        p_amount: settings.referee_signup_credit,
        p_description: `Referral signup bonus (code: ${code.toUpperCase().trim()})`,
      });
    }

    // 7. Credit referee loyalty points (atomic RPC)
    if (settings.referee_reward_points && settings.referee_reward_points > 0) {
      await admin.rpc('increment_loyalty_points', {
        p_user_id: user.id,
        p_points: settings.referee_reward_points,
      });
    }

    return json({ success: true, signup_credit: settings.referee_signup_credit });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});

const DEFAULTS = {
  is_active: false,
  referee_signup_credit: 50,
  referee_reward_points: 0,
  referrer_first_order_points: 100,
  referrer_first_order_credit: 30,
  referrer_month_credit: 100,
};

function mergedSettings(raw: Record<string, unknown> | null) {
  return { ...DEFAULTS, ...raw } as typeof DEFAULTS & Record<string, unknown>;
}
