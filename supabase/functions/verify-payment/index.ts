/**
 * 1stOne F1 — Verify Payment (Razorpay webhook)
 *
 * Razorpay calls this URL after every payment event:
 *   1. Verify HMAC-SHA256 signature against RAZORPAY_WEBHOOK_SECRET
 *   2. payment.captured / order.paid:
 *        a. Mark customer order Paid  (mark_order_paid RPC)
 *        b. Credit wallet topup       (complete_wallet_topup RPC)
 *        c. Activate subscription     (user_subscriptions.is_active = true)
 *   3. payment.failed:
 *        Mark order/topup/subscription failed
 *
 * Deploy: supabase functions deploy verify-payment --no-verify-jwt
 *
 * Razorpay Dashboard → Webhooks:
 *   URL:    https://<PROJECT>.supabase.co/functions/v1/verify-payment
 *   Events: payment.captured, payment.failed, order.paid
 *   Secret: same value as RAZORPAY_WEBHOOK_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

// HMAC-SHA256 via Web Crypto — available in all Deno/Supabase edge runtimes.
// Do NOT use deno.land/std node/crypto compat — it is unreliable in current runtime.
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
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return text('Method not allowed', 405);

  // Read env inside handler — prevents boot crash if secrets not yet injected
  const SUPABASE_URL              = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const WEBHOOK_SECRET            = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[verify-payment] Missing Supabase env vars');
    return text('Server misconfigured', 500);
  }

  // Refuse to process without a secret — anyone could flip orders to Paid
  if (!WEBHOOK_SECRET) {
    console.error('[verify-payment] RAZORPAY_WEBHOOK_SECRET not set');
    return text('Webhook secret not configured', 500);
  }

  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const raw = await req.text();

  // ── Signature validation ────────────────────────────────────
  const expected = await hmacSha256Hex(WEBHOOK_SECRET, raw);
  if (signature !== expected) {
    console.error('[verify-payment] Signature mismatch — possible spoofed request');
    return text('Invalid signature', 401);
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return text('Invalid JSON', 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const eventType: string       = event.event ?? '';
  const payment                 = event.payload?.payment?.entity ?? {};
  const razorpayOrderId: string = payment.order_id   ?? '';
  const razorpayPaymentId       = payment.id          ?? null;

  console.log('[verify-payment] Event:', eventType, 'order:', razorpayOrderId, 'payment:', razorpayPaymentId);

  if (!razorpayOrderId) {
    console.warn('[verify-payment] No order_id in payload — acking');
    return text('ok: no order_id', 200);
  }

  // ── payment.captured / order.paid ──────────────────────────
  if (eventType === 'payment.captured' || eventType === 'order.paid') {

    // 1) Customer order
    const { data: paidOrders, error: paidErr } = await supabase.rpc('mark_order_paid', {
      p_razorpay_order_id:   razorpayOrderId,
      p_razorpay_payment_id: razorpayPaymentId,
    });
    if (paidErr) {
      // Log but return 200 — returning 500 causes Razorpay to retry indefinitely
      console.error('[verify-payment] mark_order_paid error:', paidErr.message);
    } else if (paidOrders && paidOrders.length > 0) {
      console.log('[verify-payment] Customer order marked paid:', razorpayOrderId);
      const { data: orderRow } = await supabase
        .from('orders').select('id, user_id')
        .eq('razorpay_order_id', razorpayOrderId).maybeSingle();
      if (orderRow?.user_id) {
        fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            user_ids: [orderRow.user_id],
            title: 'Order Confirmed!',
            body: `Your order #${orderRow.id} payment is confirmed. We're getting it ready!`,
            data: { screen: 'OrderDetail', params: { orderId: orderRow.id } },
            trigger_source: 'order_status',
            reference_id: String(orderRow.id),
          }),
        }).catch((e: any) => console.error('[verify-payment] order push failed:', e));
      }
      return text('ok: order marked paid', 200);
    }

    // 2) Wallet topup
    const { data: topups, error: topupErr } = await supabase.rpc('complete_wallet_topup', {
      p_razorpay_order_id:   razorpayOrderId,
      p_razorpay_payment_id: razorpayPaymentId,
    });
    if (topupErr) {
      console.error('[verify-payment] complete_wallet_topup error:', topupErr.message);
    } else if (topups && topups.length > 0) {
      console.log('[verify-payment] Wallet topup credited:', razorpayOrderId);
      const { data: topupRow } = await supabase
        .from('pending_wallet_topups').select('user_id, amount')
        .eq('razorpay_order_id', razorpayOrderId).maybeSingle();
      if (topupRow?.user_id) {
        fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            user_ids: [topupRow.user_id],
            title: 'Wallet Topped Up!',
            body: `\u20b9${topupRow.amount} has been added to your wallet.`,
            data: { screen: 'Wallet' },
            trigger_source: 'wallet_topup',
            reference_id: razorpayOrderId,
          }),
        }).catch((e: any) => console.error('[verify-payment] topup push failed:', e));
      }
      return text('ok: wallet topup credited', 200);
    }

    // 3) Subscription activation
    const { data: activatedSubs, error: subErr } = await supabase
      .from('user_subscriptions')
      .update({
        is_active: true,
        razorpay_payment_id: razorpayPaymentId,
      })
      .eq('razorpay_order_id', razorpayOrderId)
      .eq('is_active', false)
      .select('id');

    if (subErr) {
      console.error('[verify-payment] Subscription activation error:', subErr.message);
      // Return 200 — retrying won't help a schema error
      return text('ok: sub activation error logged', 200);
    }

    if (activatedSubs && activatedSubs.length > 0) {
      console.log('[verify-payment] Subscription activated:', activatedSubs.map((s: any) => s.id));
      const subId = activatedSubs[0].id;
      const { data: subRow } = await supabase
        .from('user_subscriptions')
        .select('user_id, subscription_plans ( plan_name )')
        .eq('id', subId).maybeSingle();
      if (subRow?.user_id) {
        const planName = (subRow.subscription_plans as any)?.plan_name ?? 'your plan';
        fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            user_ids: [subRow.user_id],
            title: 'Subscription Activated!',
            body: `Your ${planName} subscription is now active. Enjoy your meals!`,
            data: { screen: 'Subscriptions' },
            trigger_source: 'subscription_activation',
            reference_id: String(subId),
          }),
        }).catch((e: any) => console.error('[verify-payment] sub push failed:', e));
      }
      return text('ok: subscription activated', 200);
    }

    // Nothing matched — ack so Razorpay stops retrying
    console.warn('[verify-payment] No matching order/topup/subscription for order:', razorpayOrderId);
    return text('ok: no match', 200);
  }

  // ── payment.failed ─────────────────────────────────────────
  if (eventType === 'payment.failed') {
    const reason = payment.error_description ?? payment.error_code ?? 'payment_failed';
    console.log('[verify-payment] Payment failed for order:', razorpayOrderId, 'reason:', reason);

    // Customer order
    const { error: failErr } = await supabase.rpc('mark_order_failed', {
      p_razorpay_order_id: razorpayOrderId,
      p_reason: reason,
    });
    if (failErr) {
      console.error('[verify-payment] mark_order_failed error:', failErr.message);
    } else {
      const { data: failedOrder } = await supabase
        .from('orders').select('id, user_id')
        .eq('razorpay_order_id', razorpayOrderId).maybeSingle();
      if (failedOrder?.user_id) {
        fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            user_ids: [failedOrder.user_id],
            title: 'Payment Failed',
            body: `Payment for order #${failedOrder.id} could not be processed. Please try again.`,
            data: { screen: 'Orders' },
            trigger_source: 'order_status',
            reference_id: String(failedOrder.id),
          }),
        }).catch((e: any) => console.error('[verify-payment] failed push failed:', e));
      }
    }

    // Wallet topup
    const { error: topupFailErr } = await supabase
      .from('pending_wallet_topups')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('razorpay_order_id', razorpayOrderId)
      .eq('status', 'pending');
    if (topupFailErr) console.error('[verify-payment] topup fail update error:', topupFailErr.message);

    // Subscription — stays is_active=false (never activated); just log
    const { data: pendingSubs } = await supabase
      .from('user_subscriptions')
      .select('id')
      .eq('razorpay_order_id', razorpayOrderId)
      .eq('is_active', false);
    if (pendingSubs && pendingSubs.length > 0) {
      console.log('[verify-payment] Subscription payment failed — row stays inactive:', pendingSubs.map((s: any) => s.id));
    }

    return text('ok: marked failed', 200);
  }

  // Unhandled event type — ack so Razorpay doesn't retry
  console.log('[verify-payment] Unhandled event type:', eventType);
  return text(`ok: unhandled ${eventType}`, 200);
});
