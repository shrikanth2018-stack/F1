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
import { getUserFromJwt } from '../_shared/auth.ts';
import { resolveAndSendPush } from '../_shared/notifications.ts';

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

    const user = getUserFromJwt(authHeader.replace('Bearer ', ''));
    if (!user) return json({ error: 'Unauthorized' }, 401);

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

    // Activate any subscriptions tied to this same razorpay_order_id.
    // Safe + idempotent: guarded by is_active=false + user_id + razorpay_order_id.
    // No-op when the order has no subscription lines.
    const { data: activatedSubs, error: subErr } = await supabase
      .from('user_subscriptions')
      .update({ is_active: true, razorpay_payment_id })
      .eq('razorpay_order_id', razorpay_order_id)
      .eq('user_id', user.id)
      .eq('is_active', false)
      .select('id');

    if (subErr) {
      // Non-fatal — the webhook (verify-payment) will retry activation.
      // Log for observability but don't fail the client request.
      console.error('[confirm-order] sub activation failed:', subErr.message);
    } else if (activatedSubs && activatedSubs.length > 0) {
      console.log(`[confirm-order] Activated ${activatedSubs.length} subscription(s) for order ${order_id}`);
    }

    // BF-35b: explicit push fan-out. Previously relied on the DB trigger
    // (now removed) that bypassed admin's notification_templates. Now
    // routes through resolveAndSendPush so admin can edit copy.
    resolveAndSendPush({
      supabase,
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      eventKey: 'order.razorpay_confirmed',
      userIds: [order.user_id],
      vars: { order_id },
      fallback: {
        title: 'Order Confirmed!',
        body: `Your order #${order_id} payment is confirmed. We're getting it ready!`,
      },
      data: { screen: 'OrderDetail', params: { orderId: order_id } },
      referenceId: String(order_id),
    }).catch((e: any) => console.error('[confirm-order] order push failed:', e));

    // If we activated any subscriptions, fire the dedicated activation push
    // so the customer gets the "Subscription Activated!" alert. Previously
    // this only fired from verify-payment's webhook path — when confirm-order
    // beat the webhook (common), the customer missed it.
    if (activatedSubs && activatedSubs.length > 0) {
      const subId = activatedSubs[0].id;
      const { data: subRow } = await supabase
        .from('user_subscriptions')
        .select('subscription_plans ( plan_name )')
        .eq('id', subId)
        .maybeSingle();
      const planName = (subRow as any)?.subscription_plans?.plan_name ?? 'your plan';
      resolveAndSendPush({
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
        eventKey: 'subscription.activated',
        userIds: [order.user_id],
        vars: { plan_name: planName },
        fallback: {
          title: 'Subscription Activated!',
          body: `Your ${planName} subscription is now active. Enjoy your meals!`,
        },
        data: { screen: 'Subscriptions' },
        referenceId: String(subId),
      }).catch((e: any) => console.error('[confirm-order] sub push failed:', e));
    }

    console.log(`[confirm-order] Order ${order_id} marked Confirmed`);
    return json({ status: 'paid', subscriptions_activated: activatedSubs?.length ?? 0 });

  } catch (err: any) {
    console.error('[confirm-order] Unhandled error:', err?.message);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
