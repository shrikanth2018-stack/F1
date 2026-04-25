/**
 * 1stOne F1 — Subscribe (Edge Function)
 *
 * Client -> this function: { plan_id, payment_method, start_date, user_id }
 *   payment_method: 'wallet' | 'razorpay'
 *
 * Wallet path:
 *   - Atomically debit price (decrement_wallet_balance_if_sufficient)
 *   - Insert user_subscriptions row (is_active=true, days_consumed=0)
 *
 * Razorpay path:
 *   - Create Razorpay order
 *   - Insert user_subscriptions row as provisional (is_active=false)
 *   - verify-payment webhook flips it active on payment.captured
 *
 * Deploy: supabase functions deploy subscribe --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';
import { resolveAndSendPush } from '../_shared/notifications.ts';

Deno.serve(async (req: Request) => {
  // Read env inside handler — prevents boot crash if keys not yet injected
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
  const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[subscribe] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const ALLOWED_ORIGINS = new Set([SUPABASE_URL, 'http://localhost:8081', 'http://localhost:19006']);
  const origin = req.headers.get('Origin') ?? '';
  const acao = ALLOWED_ORIGINS.has(origin) ? origin : SUPABASE_URL;
  const cors = {
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const idempotencyKey = req.headers.get('Idempotency-Key') ?? '';

    if (!authHeader) {
      console.error('[subscribe] Missing Authorization header');
      return json({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const jwt = authHeader.replace('Bearer ', '');
    const user = getUserFromJwt(jwt);
    if (!user) {
      console.error('[subscribe] Invalid or expired JWT');
      return json({ error: 'Unauthorized' }, 401);
    }
    console.log('[subscribe] User verified:', user.id);

    // Rate limit: max 5 subscribe calls per user per 60 s
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount } = await supabase
      .from('idempotency_keys')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('endpoint', 'subscribe')
      .gte('created_at', oneMinuteAgo);
    if ((recentCount ?? 0) >= 5) {
      return json({ error: 'Too many requests. Please wait a moment before trying again.' }, 429);
    }

    // Idempotency short-circuit
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from('idempotency_keys')
        .select('response')
        .eq('key', idempotencyKey)
        .eq('user_id', user.id)
        .maybeSingle();
      if (existing?.response) {
        console.log('[subscribe] Idempotency hit — returning cached response');
        return json(existing.response, 200);
      }
    }

    const body = await req.json();
    const { plan_id, payment_method, start_date } = body;
    console.log('[subscribe] Payload:', { plan_id, payment_method, start_date });

    if (!plan_id || !payment_method || !start_date) {
      return json({ error: 'plan_id, payment_method, start_date are required' }, 400);
    }
    if (payment_method !== 'wallet' && payment_method !== 'razorpay') {
      return json({ error: 'payment_method must be wallet or razorpay' }, 400);
    }

    // Load plan
    const { data: plan, error: planErr } = await supabase
      .from('subscription_plans')
      .select('id, plan_name, cycle_id, duration_days, price, plan_type, is_active, branch_id')
      .eq('id', plan_id)
      .maybeSingle();
    if (planErr) {
      console.error('[subscribe] Plan fetch error:', planErr.message);
      throw planErr;
    }
    if (!plan || !plan.is_active) {
      console.error('[subscribe] Plan unavailable:', plan_id);
      return json({ error: 'Plan unavailable' }, 400);
    }
    console.log('[subscribe] Plan loaded:', { id: plan.id, price: plan.price, cycle_id: plan.cycle_id });

    // Conflict check: reject only if date ranges actually overlap.
    // A queued sub starting after the current one ends is allowed.
    const { data: existingSubs } = await supabase
      .from('user_subscriptions')
      .select('id, start_date, subscription_plans ( cycle_id, plan_type, duration_days )')
      .eq('user_id', user.id)
      .eq('is_active', true);

    const MS_PER_DAY = 86_400_000;
    const newStartMs = new Date(start_date).getTime();
    const newEndMs   = newStartMs + (plan.duration_days - 1) * MS_PER_DAY;

    // Treat null plan_type (legacy rows created before the column existed) as 'food'
    const newPlanType = plan.plan_type ?? 'food';
    const conflict = (existingSubs ?? []).some((s: any) => {
      if (s.subscription_plans?.cycle_id !== plan.cycle_id) return false;
      const existingType = s.subscription_plans?.plan_type ?? 'food';
      if (existingType !== newPlanType) return false;
      const existingDuration = s.subscription_plans?.duration_days ?? 0;
      const existingStartMs  = new Date(s.start_date).getTime();
      const existingEndMs    = existingStartMs + (existingDuration - 1) * MS_PER_DAY;
      // Ranges overlap when: newStart ≤ existingEnd AND existingStart ≤ newEnd
      return newStartMs <= existingEndMs && existingStartMs <= newEndMs;
    });

    if (conflict) {
      console.log('[subscribe] Date overlap — new sub conflicts with existing active range');
      return json({
        error: 'Your chosen start date overlaps with an existing subscription. Please select a later date.',
      }, 409);
    }

    // ── Wallet path ────────────────────────────────────────────
    if (payment_method === 'wallet') {
      console.log('[subscribe] Wallet path — debiting:', plan.price);
      const { data: debited, error: debitErr } = await supabase.rpc(
        'decrement_wallet_balance_if_sufficient',
        { p_user_id: user.id, p_amount: plan.price, p_description: `Subscription plan ${plan.id}` },
      );
      if (debitErr) {
        console.error('[subscribe] Wallet debit RPC error:', debitErr.message);
        throw new Error(`Wallet debit failed: ${debitErr.message}`);
      }
      if (debited !== true) {
        console.log('[subscribe] Insufficient wallet balance');
        return json({ error: 'Insufficient wallet balance' }, 400);
      }

      const { data: sub, error: subErr } = await supabase
        .from('user_subscriptions')
        .insert({
          user_id: user.id,
          plan_id: plan.id,
          start_date,
          days_consumed: 0,
          is_active: true,
          is_paused: false,
          payment_method: 'wallet',
          wallet_amount_used: plan.price,
          razorpay_order_id: null,
          branch_id: plan.branch_id ?? null,
        })
        .select('id')
        .single();

      if (subErr) {
        console.error('[subscribe] Subscription insert error:', subErr.message);
        // Rollback debit
        await supabase.rpc('increment_wallet_balance', {
          p_user_id: user.id,
          p_amount: plan.price,
          p_description: 'Subscription creation failed — refund',
        });
        throw new Error(`Subscription insert failed: ${subErr.message}`);
      }

      const response = { subscription_id: sub!.id, status: 'active', payment_method: 'wallet' };
      if (idempotencyKey) {
        await supabase.from('idempotency_keys').insert({
          key: idempotencyKey, user_id: user.id, endpoint: 'subscribe', response,
        });
      }
      console.log('[subscribe] Wallet subscription created:', sub!.id);
      resolveAndSendPush({
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
        eventKey: 'subscription.activated',
        userIds: [user.id],
        vars: { plan_name: (plan as any).plan_name ?? 'subscription', start_date },
        fallback: {
          title: 'Subscription Activated!',
          body: `Your ${(plan as any).plan_name ?? 'subscription'} is active. First delivery starts ${start_date}.`,
        },
        data: { screen: 'Subscriptions' },
        referenceId: String(sub!.id),
      }).catch((e: any) => console.error('[subscribe] push failed:', e));
      return json(response, 200);
    }

    // ── Razorpay path ──────────────────────────────────────────
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      console.error('[subscribe] Razorpay keys not configured');
      return json({ error: 'Razorpay not configured on server' }, 500);
    }

    console.log('[subscribe] Razorpay path — creating order for amount:', plan.price);
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)}`,
      },
      body: JSON.stringify({
        amount: Math.round(plan.price * 100),
        currency: 'INR',
        receipt: `sub_${user.id.slice(0, 8)}_${Date.now()}`,
        notes: { user_id: user.id, plan_id: plan.id, kind: 'subscription' },
      }),
    });
    const rzpOrder = await rzpRes.json();
    console.log('[subscribe] Razorpay order response:', JSON.stringify(rzpOrder));

    if (!rzpOrder.id) {
      console.error('[subscribe] Razorpay order creation failed:', JSON.stringify(rzpOrder));
      return json({ error: 'Payment gateway error', details: rzpOrder }, 502);
    }

    const { data: sub, error: subErr } = await supabase
      .from('user_subscriptions')
      .insert({
        user_id: user.id,
        plan_id: plan.id,
        start_date,
        days_consumed: 0,
        is_active: false,
        is_paused: false,
        payment_method: 'razorpay',
        wallet_amount_used: 0,
        razorpay_order_id: rzpOrder.id,
        branch_id: plan.branch_id ?? null,
      })
      .select('id')
      .single();

    if (subErr) {
      console.error('[subscribe] Provisional subscription insert error:', subErr.message);
      throw new Error(`Subscription insert failed: ${subErr.message}`);
    }

    const response = {
      subscription_id: sub!.id,
      status: 'pending_payment',
      payment_method: 'razorpay',
      razorpay_order_id: rzpOrder.id,
      amount: plan.price,
    };
    if (idempotencyKey) {
      await supabase.from('idempotency_keys').insert({
        key: idempotencyKey, user_id: user.id, endpoint: 'subscribe', response,
      });
    }
    console.log('[subscribe] Razorpay subscription provisional, order:', rzpOrder.id);
    return json(response, 200);

  } catch (err: any) {
    console.error('[subscribe] Unhandled exception:', err?.message, err?.stack);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
