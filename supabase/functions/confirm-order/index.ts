/**
 * 1stOne F1 — Confirm Order (client-side Razorpay verification)
 *
 * Called by the app after the Razorpay SDK resolves with payment data.
 * Verifies the payment signature using RAZORPAY_KEY_SECRET and marks the
 * order as Paid — no webhook required.
 *
 * In production both this endpoint and the webhook run; whichever fires
 * first wins (mark_order_paid is idempotent via status guard).
 *
 * Input:  { order_id, razorpay_payment_id, razorpay_order_id, razorpay_signature }
 * Output: { status: 'paid' | 'already_paid' } | { error: string }
 *
 * Deploy: supabase functions deploy confirm-order --no-verify-jwt
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

  if (!RAZORPAY_KEY_SECRET) {
    return json({ error: 'Payment gateway not configured' }, 500);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json();
    const { order_id, razorpay_payment_id, razorpay_order_id, razorpay_signature } = body;

    if (!order_id || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return json({ error: 'Missing required fields' }, 400);
    }

    // Verify the order belongs to this user and check current status
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, user_id, status, razorpay_order_id')
      .eq('id', order_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (orderErr) throw orderErr;
    if (!order) return json({ error: 'Order not found' }, 404);

    // Idempotency: already confirmed — return immediately without re-processing
    if (order.status === 'Confirmed' || order.status === 'Paid') {
      return json({ status: 'already_confirmed' });
    }

    if (order.status !== 'Pending') {
      return json({ error: `Order is ${order.status}, cannot confirm payment` }, 409);
    }

    // Verify the razorpay_order_id matches what we stored
    if (order.razorpay_order_id && order.razorpay_order_id !== razorpay_order_id) {
      return json({ error: 'Order ID mismatch' }, 400);
    }

    // HMAC-SHA256 signature verification
    // Razorpay signs: razorpay_order_id + "|" + razorpay_payment_id
    const expectedSig = await hmacSha256Hex(
      RAZORPAY_KEY_SECRET,
      `${razorpay_order_id}|${razorpay_payment_id}`,
    );

    if (expectedSig !== razorpay_signature) {
      console.error('[confirm-order] Signature mismatch for order:', order_id);
      return json({ error: 'Invalid payment signature' }, 401);
    }

    // Service-role client bypasses RLS — direct update is safe here.
    // Idempotent: only transitions Pending → Paid.
    const { error: paidErr } = await supabase
      .from('orders')
      .update({ status: 'Confirmed' })
      .eq('id', order_id)
      .eq('user_id', user.id)
      .eq('status', 'Pending');

    if (paidErr) {
      console.error('[confirm-order] update failed:', paidErr.message);
      throw new Error(paidErr.message);
    }

    console.log(`[confirm-order] Order ${order_id} marked Confirmed`);
    return json({ status: 'paid' });

  } catch (err: any) {
    console.error('[confirm-order] Unhandled error:', err?.message);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
