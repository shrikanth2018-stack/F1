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
import { resolveAndSendPush } from '../_shared/notifications.ts';

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
  //
  // A single razorpay_order_id can map to BOTH an order row AND one-or-more
  // user_subscriptions rows (cart-driven subscription purchase). Run all three
  // branches per webhook call — each is idempotent and no-ops when nothing
  // matches. Do NOT early-return on the first match.
  if (eventType === 'payment.captured' || eventType === 'order.paid') {
    let matchedAny = false;

    // 1) Customer order
    const { data: paidOrders, error: paidErr } = await supabase.rpc('mark_order_paid', {
      p_razorpay_order_id:   razorpayOrderId,
      p_razorpay_payment_id: razorpayPaymentId,
    });
    if (paidErr) {
      // Log but return 200 — returning 500 causes Razorpay to retry indefinitely
      console.error('[verify-payment] mark_order_paid error:', paidErr.message);
    } else if (paidOrders && paidOrders.length > 0) {
      matchedAny = true;
      // MF-10: mark_order_paid flips every order sharing this
      // razorpay_order_id (one per dispatch cycle) and RETURNs them all.
      // Use the primary returned row directly — a re-query with
      // .maybeSingle() would error now that multiple rows can match.
      // One push per group, keyed on the primary order.
      console.log('[verify-payment] Customer order(s) marked paid:', razorpayOrderId, paidOrders.map((o: any) => o.order_id));
      const primary = paidOrders[0];
      if (primary?.user_id) {
        resolveAndSendPush({
          supabase,
          supabaseUrl: SUPABASE_URL,
          serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
          eventKey: 'order.razorpay_confirmed',
          userIds: [primary.user_id],
          vars: { order_id: primary.order_id },
          fallback: {
            title: 'Order Confirmed!',
            body: `Your order #${primary.order_id} payment is confirmed. We're getting it ready!`,
          },
          data: { screen: 'OrderDetail', params: { orderId: primary.order_id } },
          referenceId: String(primary.order_id),
        }).catch((e: any) => console.error('[verify-payment] order push failed:', e));
      }
    }

    // 2) Wallet topup
    const { data: topups, error: topupErr } = await supabase.rpc('complete_wallet_topup', {
      p_razorpay_order_id:   razorpayOrderId,
      p_razorpay_payment_id: razorpayPaymentId,
    });
    if (topupErr) {
      console.error('[verify-payment] complete_wallet_topup error:', topupErr.message);
    } else if (topups && topups.length > 0) {
      matchedAny = true;
      console.log('[verify-payment] Wallet topup credited:', razorpayOrderId);
      const { data: topupRow } = await supabase
        .from('pending_wallet_topups').select('user_id, amount')
        .eq('razorpay_order_id', razorpayOrderId).maybeSingle();
      if (topupRow?.user_id) {
        resolveAndSendPush({
          supabase,
          supabaseUrl: SUPABASE_URL,
          serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
          eventKey: 'wallet.topped_up',
          userIds: [topupRow.user_id],
          vars: { amount: topupRow.amount },
          fallback: {
            title: 'Wallet Topped Up!',
            body: `\u20b9${topupRow.amount} has been added to your wallet.`,
          },
          data: { screen: 'Wallet' },
          referenceId: razorpayOrderId,
        }).catch((e: any) => console.error('[verify-payment] topup push failed:', e));
      }
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
    } else if (activatedSubs && activatedSubs.length > 0) {
      matchedAny = true;
      console.log('[verify-payment] Subscription activated:', activatedSubs.map((s: any) => s.id));
      const subId = activatedSubs[0].id;
      const { data: subRow } = await supabase
        .from('user_subscriptions')
        .select('user_id, subscription_plans ( plan_name )')
        .eq('id', subId).maybeSingle();
      if (subRow?.user_id) {
        const planName = (subRow.subscription_plans as any)?.plan_name ?? 'your plan';
        resolveAndSendPush({
          supabase,
          supabaseUrl: SUPABASE_URL,
          serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
          eventKey: 'subscription.activated',
          userIds: [subRow.user_id],
          vars: { plan_name: planName },
          fallback: {
            title: 'Subscription Activated!',
            body: `Your ${planName} subscription is now active. Enjoy your meals!`,
          },
          data: { screen: 'Subscriptions' },
          referenceId: String(subId),
        }).catch((e: any) => console.error('[verify-payment] sub push failed:', e));
      }
    }

    if (!matchedAny) {
      console.warn('[verify-payment] No matching order/topup/subscription for order:', razorpayOrderId);
    }
    return text('ok', 200);
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
      // MF-10: mark_order_failed flips every order sharing this
      // razorpay_order_id — .limit(1) keeps this push lookup single-row.
      const { data: failedOrder } = await supabase
        .from('orders').select('id, user_id')
        .eq('razorpay_order_id', razorpayOrderId).limit(1).maybeSingle();
      if (failedOrder?.user_id) {
        resolveAndSendPush({
          supabase,
          supabaseUrl: SUPABASE_URL,
          serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
          eventKey: 'order.payment_failed',
          userIds: [failedOrder.user_id],
          vars: { order_id: failedOrder.id },
          fallback: {
            title: 'Payment Failed',
            body: `Payment for order #${failedOrder.id} could not be processed. Please try again.`,
          },
          data: { screen: 'Orders' },
          referenceId: String(failedOrder.id),
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
