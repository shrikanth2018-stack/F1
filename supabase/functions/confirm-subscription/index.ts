/**
 * 1stOne F1 — Confirm Subscription (client-side Razorpay verification)
 *
 * Called by the app after the Razorpay SDK resolves with payment data.
 * Verifies the payment signature using RAZORPAY_KEY_SECRET and activates
 * the subscription — no webhook required.
 *
 * Idempotency (two-layer):
 *   1. Early precheck: if subscription is already active with the same
 *      razorpay_payment_id, return `already_active` immediately — no HMAC work.
 *   2. DB guard: .eq('is_active', false) prevents concurrent double-activation
 *      even when two requests race through the precheck simultaneously.
 *
 * Input:  { subscription_id, razorpay_payment_id, razorpay_order_id, razorpay_signature }
 * Output: { status: 'activated' | 'already_active' } | { error: string }
 *
 * Deploy: supabase functions deploy confirm-subscription --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_PROJECT_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ALLOWED_ORIGINS = new Set([
  SUPABASE_PROJECT_URL,
  'http://localhost:8081',
  'http://localhost:19006',
]);

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  // ── CORS ────────────────────────────────────────────────────
  const origin = req.headers.get('Origin') ?? '';
  const acao = ALLOWED_ORIGINS.has(origin) ? origin : SUPABASE_PROJECT_URL;
  const cors = {
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Server misconfigured' }, 500);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json();
    const { subscription_id, razorpay_payment_id, razorpay_order_id, razorpay_signature } = body;

    if (!subscription_id || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return json({
        error: 'subscription_id, razorpay_payment_id, razorpay_order_id, razorpay_signature are required',
      }, 400);
    }

    // ── Idempotency precheck ───────────────────────────────────
    // Load the subscription first. If it's already active with the same
    // payment_id, this is a retry — return success immediately without
    // re-running HMAC or touching the DB again.
    const { data: sub, error: fetchErr } = await supabase
      .from('user_subscriptions')
      .select('id, is_active, razorpay_payment_id')
      .eq('id', subscription_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!sub) return json({ error: 'Subscription not found' }, 404);

    if (sub.is_active && sub.razorpay_payment_id === razorpay_payment_id) {
      console.log('[confirm-subscription] Idempotent repeat for subscription:', subscription_id);
      return json({ status: 'already_active' });
    }

    // If active with a DIFFERENT payment_id → something is wrong
    if (sub.is_active) {
      console.error('[confirm-subscription] Already active with different payment:', subscription_id);
      return json({ error: 'Subscription already active' }, 409);
    }

    // ── Verify Razorpay signature ──────────────────────────────
    if (!RAZORPAY_KEY_SECRET) {
      console.error('[confirm-subscription] RAZORPAY_KEY_SECRET not set');
      return json({ error: 'Payment verification not configured' }, 500);
    }

    const expectedSignature = await hmacSha256Hex(
      RAZORPAY_KEY_SECRET,
      `${razorpay_order_id}|${razorpay_payment_id}`,
    );

    if (expectedSignature !== razorpay_signature) {
      console.error('[confirm-subscription] Signature mismatch for subscription:', subscription_id);
      return json({ error: 'Payment verification failed' }, 400);
    }

    // ── Activate — DB guard prevents concurrent double-activation ──
    const { data: updated, error: updateErr } = await supabase
      .from('user_subscriptions')
      .update({ is_active: true, razorpay_payment_id })
      .eq('id', subscription_id)
      .eq('user_id', user.id)
      .eq('is_active', false)          // concurrent race: only one writer wins
      .select('id');

    if (updateErr) {
      console.error('[confirm-subscription] Update error:', updateErr.message);
      return json({ error: 'Activation failed' }, 500);
    }

    if (!updated || updated.length === 0) {
      // Webhook beat us between precheck and update — still success for client
      console.log('[confirm-subscription] Webhook already activated:', subscription_id);
      return json({ status: 'already_active' });
    }

    console.log('[confirm-subscription] Subscription activated:', subscription_id);
    return json({ status: 'activated' });

  } catch (err: any) {
    console.error('[confirm-subscription] Unhandled error:', err?.message);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
