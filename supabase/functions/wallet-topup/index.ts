/**
 * 1stOne F1 — Wallet Topup (Edge Function)
 *
 * Client -> this function: { amount }
 * This function:
 *   1. Validates min/max against store_config
 *   2. Creates a Razorpay order
 *   3. Records pending_wallet_topups(razorpay_order_id, user_id, amount, pending)
 *   4. Returns { razorpay_order_id, amount } to the client
 * Client then opens Razorpay Checkout; on success, verify-payment webhook
 * flips the topup to 'completed' and credits the wallet atomically.
 *
 * NEVER credits the wallet itself — that only happens on webhook confirmation.
 *
 * Deploy: supabase functions deploy wallet-topup --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';

const ALLOWED_ORIGINS = new Set([
  SUPABASE_URL,
  'http://localhost:8081',
  'http://localhost:19006',
]);

serve(async (req) => {
  const origin = req.headers.get('Origin') ?? '';
  const acao = ALLOWED_ORIGINS.has(origin) ? origin : SUPABASE_URL;
  const cors = {
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const idempotencyKey = req.headers.get('Idempotency-Key') ?? '';

    const user = getUserFromJwt(authHeader.replace('Bearer ', ''));
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Rate limit: max 5 wallet-topup calls per user per 60 s
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount } = await supabase
      .from('idempotency_keys')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('endpoint', 'wallet-topup')
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
      if (existing?.response) return json(existing.response, 200);
    }

    const { amount } = await req.json();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return json({ error: 'Amount must be a positive number' }, 400);
    }

    // Enforce store-config min/max. BF-32b: column name is `min_wallet_topup`
    // (the earlier `wallet_min_topup` select silently failed and fell through
    // to the hardcoded 100 fallback, bypassing admin's configured value).
    // No `max_wallet_topup` column exists yet — keep a hardcoded ceiling
    // until admin UI grows one.
    const { data: config } = await supabase
      .from('store_config')
      .select('min_wallet_topup')
      .limit(1)
      .maybeSingle();
    const minTopup = config?.min_wallet_topup ?? 100;
    const maxTopup = 50000;
    if (amt < minTopup) return json({ error: `Minimum top-up is ₹${minTopup}` }, 400);
    if (amt > maxTopup) return json({ error: `Maximum top-up is ₹${maxTopup}` }, 400);

    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return json({ error: 'Razorpay not configured' }, 500);
    }

    // Create the Razorpay order
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)}`,
      },
      body: JSON.stringify({
        amount: Math.round(amt * 100),
        currency: 'INR',
        receipt: `topup_${user.id.slice(0, 8)}_${Date.now()}`,
        notes: { user_id: user.id, kind: 'wallet_topup' },
      }),
    });
    const rzpOrder = await rzpRes.json();
    if (!rzpOrder.id) return json({ error: 'Payment gateway error', details: rzpOrder }, 502);

    // Record pending topup — verify-payment webhook flips it to 'completed'
    const { error: insertErr } = await supabase.from('pending_wallet_topups').insert({
      razorpay_order_id: rzpOrder.id,
      user_id: user.id,
      amount: amt,
      status: 'pending',
    });
    if (insertErr) return json({ error: `Could not record topup: ${insertErr.message}` }, 500);

    const response = { razorpay_order_id: rzpOrder.id, amount: amt };

    if (idempotencyKey) {
      await supabase.from('idempotency_keys').insert({
        key: idempotencyKey,
        user_id: user.id,
        endpoint: 'wallet-topup',
        response,
      });
    }

    return json(response, 200);
  } catch (err: any) {
    return json({ error: err.message ?? 'Internal server error' }, 500);
  }
});
