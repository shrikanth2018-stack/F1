/**
 * 1stOne F1 — Subscribe (Edge Function)
 *
 * Client -> this function: { plan_id, payment_method, start_date, user_id }
 *   payment_method: 'wallet' | 'razorpay'
 *
 * Wallet path:
 *   - Atomically debit price (decrement_wallet_balance_if_sufficient)
 *   - Insert user_subscriptions row (is_active=true, days_consumed=0)
 *   - Idempotency: (user_id, plan_id, start_date) must not duplicate active sub
 *
 * Razorpay path:
 *   - Create Razorpay order
 *   - Insert user_subscriptions row as provisional (is_active=false)
 *   - Client opens Razorpay Checkout; verify-payment webhook flips it live
 *   - For this v1 we rely on the client calling back with payment_id to flip;
 *     webhook enhancement is wired through the same mark_order_paid path but
 *     on a separate 'subscription_orders' hook — out of scope for this release.
 *
 * Deploy: supabase functions deploy subscribe --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const idempotencyKey = req.headers.get('Idempotency-Key') ?? '';

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Idempotency short-circuit
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from('idempotency_keys')
        .select('response')
        .eq('key', idempotencyKey)
        .eq('user_id', user.id)
        .maybeSingle();
      if (existing?.response) return json(existing.response, 200);
    }

    const body = await req.json();
    const { plan_id, payment_method, start_date } = body;

    if (!plan_id || !payment_method || !start_date) {
      return json({ error: 'plan_id, payment_method, start_date are required' }, 400);
    }
    if (payment_method !== 'wallet' && payment_method !== 'razorpay') {
      return json({ error: 'payment_method must be wallet or razorpay' }, 400);
    }

    // Load plan
    const { data: plan, error: planErr } = await supabase
      .from('subscription_plans')
      .select('id, cycle_id, duration_days, price, plan_type, is_active, branch_id')
      .eq('id', plan_id)
      .maybeSingle();
    if (planErr) throw planErr;
    if (!plan || !plan.is_active) return json({ error: 'Plan unavailable' }, 400);

    // Conflict: no second active sub with same cycle + plan_type
    const { data: existingSubs } = await supabase
      .from('user_subscriptions')
      .select(`
        id,
        plan_id,
        subscription_plans ( cycle_id, plan_type )
      `)
      .eq('user_id', user.id)
      .eq('is_active', true);

    const conflict = (existingSubs ?? []).some((s: any) =>
      s.subscription_plans?.cycle_id === plan.cycle_id &&
      s.subscription_plans?.plan_type === plan.plan_type,
    );
    if (conflict) {
      return json({ error: 'You already have an active plan for this cycle + type' }, 409);
    }

    // ── Wallet path ────────────────────────────────────────────
    if (payment_method === 'wallet') {
      const { data: debited, error: debitErr } = await supabase.rpc(
        'decrement_wallet_balance_if_sufficient',
        {
          p_user_id: user.id,
          p_amount: plan.price,
          p_description: `Subscription plan ${plan.id}`,
        },
      );
      if (debitErr) throw new Error(`Wallet debit RPC failed: ${debitErr.message}`);
      if (debited !== true) return json({ error: 'Insufficient wallet balance' }, 400);

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
          key: idempotencyKey,
          user_id: user.id,
          endpoint: 'subscribe',
          response,
        });
      }
      return json(response, 200);
    }

    // ── Razorpay path ──────────────────────────────────────────
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return json({ error: 'Razorpay not configured' }, 500);
    }
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
    if (!rzpOrder.id) return json({ error: 'Payment gateway error', details: rzpOrder }, 502);

    // Provisional subscription (is_active=false until webhook confirms)
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

    if (subErr) throw new Error(`Subscription insert failed: ${subErr.message}`);

    const response = {
      subscription_id: sub!.id,
      status: 'pending_payment',
      payment_method: 'razorpay',
      razorpay_order_id: rzpOrder.id,
      amount: plan.price,
    };
    if (idempotencyKey) {
      await supabase.from('idempotency_keys').insert({
        key: idempotencyKey,
        user_id: user.id,
        endpoint: 'subscribe',
        response,
      });
    }
    return json(response, 200);
  } catch (err: any) {
    return json({ error: err.message ?? 'Internal server error' }, 500);
  }
});
