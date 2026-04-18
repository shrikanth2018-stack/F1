/**
 * 1stOne F1 — Verify Payment (Razorpay webhook)
 *
 * Razorpay calls this URL after every payment event. We:
 *   1. Verify the signature (HMAC-SHA256 of the raw body with webhook secret)
 *   2. On payment.captured: flip the matching order to 'Paid' (or credit a
 *      wallet topup), send a kitchen/customer push if we have one wired.
 *   3. On payment.failed:   flip the matching order to 'Failed' (or mark the
 *      topup failed).
 *
 * Configure:
 *   Razorpay dashboard → Webhooks → new webhook URL →
 *     https://<PROJECT>.supabase.co/functions/v1/verify-payment
 *   Events: payment.captured, payment.failed, order.paid
 *   Secret: same value as RAZORPAY_WEBHOOK_SECRET env var
 *
 * Deploy: supabase functions deploy verify-payment --no-verify-jwt
 * Env:
 *   RAZORPAY_WEBHOOK_SECRET (required)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-razorpay-signature',
};

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return text('Method not allowed', 405);

  if (!WEBHOOK_SECRET) {
    // Refuse to run without a secret — otherwise anyone can flip orders to Paid.
    return text('Webhook secret not configured', 500);
  }

  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const raw = await req.text();

  // ── Signature check ─────────────────────────────────────────
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  if (signature !== expected) {
    return text('Invalid signature', 401);
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return text('Invalid JSON', 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const eventType: string = event.event ?? '';
  const payment = event.payload?.payment?.entity ?? {};
  const razorpayOrderId: string | null = payment.order_id ?? null;
  const razorpayPaymentId: string | null = payment.id ?? null;

  if (!razorpayOrderId) return text('No order_id in payload', 400);

  // ── Success: payment.captured or order.paid ─────────────────
  if (eventType === 'payment.captured' || eventType === 'order.paid') {
    // 1) Try to mark a customer order as Paid
    const { data: paidOrders, error: paidErr } = await supabase.rpc('mark_order_paid', {
      p_razorpay_order_id: razorpayOrderId,
      p_razorpay_payment_id: razorpayPaymentId,
    });
    if (paidErr) {
      console.error('[verify-payment] mark_order_paid error', paidErr);
      return text('DB error on mark_order_paid', 500);
    }

    if (paidOrders && paidOrders.length > 0) {
      return text('ok: order marked paid', 200);
    }

    // 2) Not a customer order — try completing a wallet topup
    const { data: topups, error: topupErr } = await supabase.rpc('complete_wallet_topup', {
      p_razorpay_order_id: razorpayOrderId,
      p_razorpay_payment_id: razorpayPaymentId,
    });
    if (topupErr) {
      console.error('[verify-payment] complete_wallet_topup error', topupErr);
      return text('DB error on complete_wallet_topup', 500);
    }

    if (topups && topups.length > 0) {
      return text('ok: wallet topup credited', 200);
    }

    // 3) Not a topup — check if this is a Razorpay subscription payment
    const { data: activatedSubs, error: subActivateErr } = await supabase
      .from('user_subscriptions')
      .update({ is_active: true })
      .eq('razorpay_order_id', razorpayOrderId)
      .eq('is_active', false)
      .select('id');

    if (subActivateErr) {
      console.error('[verify-payment] subscription activation error', subActivateErr);
      // Don't return 500 — fall through so Razorpay gets a 200 and stops retrying
    } else if (activatedSubs && activatedSubs.length > 0) {
      return text('ok: subscription activated', 200);
    }

    // Nothing matched — log and return 200 so Razorpay stops retrying
    console.warn(`[verify-payment] no matching order, topup, or subscription for ${razorpayOrderId}`);
    return text('ok: no match', 200);
  }

  // ── Failure: payment.failed ─────────────────────────────────
  if (eventType === 'payment.failed') {
    const reason = payment.error_description ?? payment.error_code ?? 'payment_failed';

    const { error: failErr } = await supabase.rpc('mark_order_failed', {
      p_razorpay_order_id: razorpayOrderId,
      p_reason: reason,
    });
    if (failErr) {
      console.error('[verify-payment] mark_order_failed error', failErr);
    }

    // Also mark the topup row failed if any
    await supabase
      .from('pending_wallet_topups')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('razorpay_order_id', razorpayOrderId)
      .eq('status', 'pending');

    return text('ok: marked failed', 200);
  }

  // Unhandled event — ack so Razorpay doesn't retry
  return text(`ok: unhandled ${eventType}`, 200);
});
