/**
 * 1stOne F1 — Confirm Wallet Topup (client-side Razorpay verification)
 *
 * Called by the app after the Razorpay SDK resolves for a wallet top-up.
 * Verifies the payment signature using RAZORPAY_KEY_SECRET and credits
 * the wallet immediately — no webhook required.
 *
 * The verify-payment webhook also runs in production; whichever fires
 * first wins (complete_wallet_topup is idempotent via status guard).
 *
 * Input:  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Output: { status: 'credited', amount } | { status: 'already_credited' } | { error }
 *
 * Deploy: supabase functions deploy confirm-topup --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';

const SUPABASE_PROJECT_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ALLOWED_ORIGINS = new Set([
  SUPABASE_PROJECT_URL,
  'http://localhost:8081',
  'http://localhost:19006',
]);

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
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

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Server misconfigured' }, 500);
  if (!RAZORPAY_KEY_SECRET) return json({ error: 'Payment gateway not configured' }, 500);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const user = getUserFromJwt(authHeader.replace('Bearer ', ''));
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return json({ error: 'Missing required fields' }, 400);
    }

    // Verify ownership — topup must belong to this user
    const { data: topup } = await supabase
      .from('pending_wallet_topups')
      .select('user_id, amount, status')
      .eq('razorpay_order_id', razorpay_order_id)
      .maybeSingle();

    if (!topup) return json({ error: 'Topup not found' }, 404);
    if (topup.user_id !== user.id) return json({ error: 'Unauthorized' }, 401);

    // Idempotency: already credited
    if (topup.status === 'completed') return json({ status: 'already_credited' });

    // HMAC-SHA256 signature verification (same as confirm-order)
    const expectedSig = await hmacSha256Hex(
      RAZORPAY_KEY_SECRET,
      `${razorpay_order_id}|${razorpay_payment_id}`,
    );
    if (expectedSig !== razorpay_signature) {
      console.error('[confirm-topup] Signature mismatch for order:', razorpay_order_id);
      return json({ error: 'Invalid payment signature' }, 401);
    }

    // Credit the wallet via SECURITY DEFINER RPC (bypasses RLS, idempotent)
    const { data: rows, error: rpcErr } = await supabase.rpc('complete_wallet_topup', {
      p_razorpay_order_id: razorpay_order_id,
      p_razorpay_payment_id: razorpay_payment_id,
    });

    if (rpcErr) {
      console.error('[confirm-topup] complete_wallet_topup failed:', rpcErr.message);
      throw new Error(rpcErr.message);
    }

    const credited = rows?.[0]?.amount ?? topup.amount;
    console.log(`[confirm-topup] Wallet credited ₹${credited} for user ${user.id}`);
    return json({ status: 'credited', amount: credited });

  } catch (err: any) {
    console.error('[confirm-topup] Unhandled error:', err?.message);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
