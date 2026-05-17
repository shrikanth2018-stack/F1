/**
 * 1stOne F1 — Place Order Edge Function (server-authoritative)
 *
 * The client sends only its CART — item ids + quantities, address, payment
 * method. It does NOT send cycles, dispatch dates, or money. The server
 * derives all of that via the shared builder (_shared/orderBuild.ts), the
 * same one `quote-order` uses — so the quoted price and the charged price
 * can never diverge in logic.
 *
 * Rules (do not weaken without agreement):
 *   1. `client_quote` is REQUIRED — the echo of the quote the customer last
 *      saw. Missing → 409 quote_required (client re-quotes + retries).
 *   2. The server re-derives the authoritative quote and compares its drift
 *      tuple (integer paise) to client_quote. Mismatch → 409 quote_changed
 *      with the fresh quote; NO order, NO Razorpay order, NO wallet touched.
 *   3. The echo is only a tripwire — the created order always uses the
 *      server's fresh derivation, never the echoed numbers.
 *   4. Every 409 is logged with before/after.
 *   5. Idempotency-Key is enforced; the idempotency row is written ONLY on a
 *      successful order, so a 409/4xx does not consume the key.
 *   6. dispatch_date is derived server-side (IST) — never trusted from the
 *      client.
 *
 * Deploy: supabase functions deploy place-order --no-verify-jwt
 * NOTE: the payload shape is NOT backward-compatible — deploy together with
 * the matching app build.
 *
 * Body:
 *   items: [{ item_id, item_type:'food'|'essential', quantity }]
 *   subscription_plans: [{ plan_id, start_date }]   (optional)
 *   delivery_address_id, payment_method, notes
 *   client_quote: { total_paise, dispatches:[{cycle_id,dispatch_date,group_total_paise}] }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';
import { resolveAndSendPush } from '../_shared/notifications.ts';
import { buildAuthoritativeOrder, curateQuote } from '../_shared/orderBuild.ts';
import { driftedFields } from '../_shared/dispatch.ts';

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

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const idempotencyKey = req.headers.get('Idempotency-Key') ?? '';

    const user = getUserFromJwt(authHeader.replace('Bearer ', ''));
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Rate limit: max 5 place-order calls per user per 60 s ──
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount } = await supabase
      .from('idempotency_keys')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('endpoint', 'place-order')
      .gte('created_at', oneMinuteAgo);
    if ((recentCount ?? 0) >= 5) {
      return json({ error: 'Too many requests. Please wait a moment before trying again.' }, 429);
    }

    // ── Idempotency short-circuit ──────────────────────────────
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
    const {
      items = [],
      subscription_plans = [],
      delivery_address_id,
      payment_method,
      notes,
      client_quote,
      groups: legacyGroups,
    } = body ?? {};

    // ── Outdated app guard ─────────────────────────────────────
    // The pre-server-authority build sent `groups`. That contract is gone.
    if (legacyGroups !== undefined) {
      return json({ error: 'Please update the 1stOne app to the latest version to place orders.' }, 400);
    }

    if (!delivery_address_id) {
      return json({ error: 'Delivery address is required' }, 400);
    }
    if (payment_method !== 'wallet' && payment_method !== 'razorpay') {
      return json({ error: 'Invalid payment method' }, 400);
    }

    // ── client_quote is REQUIRED (rule 1) ──────────────────────
    if (!client_quote || typeof client_quote.total_paise !== 'number') {
      console.error('[place-order] quote-required', { user_id: user.id });
      return json({ error: 'quote_required' }, 409);
    }

    // ── Server-authoritative derivation (one clock read) ───────
    const result = await buildAuthoritativeOrder({
      supabase,
      userId: user.id,
      items,
      subscriptionPlans: subscription_plans,
      deliveryAddressId: delivery_address_id,
      now: new Date(),
    });
    if (!result.ok) {
      return json({ error: result.error }, result.status);
    }
    const order = result.order;

    // ── Storm mode + serviceability (server-enforced) ──────────
    if (order.storm_mode) {
      return json({ error: 'Orders are temporarily paused. Please try again shortly.' }, 403);
    }
    if (!order.serviceable) {
      return json({ error: 'This delivery address is outside our service area.' }, 400);
    }

    // ── Drift check (rule 2) — before ANY money side-effect ────
    const changed = driftedFields(
      { total_paise: order.total_paise, dispatches: order.dispatches },
      client_quote,
    );
    if (changed.length > 0) {
      // rule 4 — log every 409 with before/after.
      console.error('[place-order] quote-drift', {
        user_id: user.id,
        changed,
        before: { total_paise: client_quote.total_paise, dispatches: client_quote.dispatches },
        after: { total_paise: order.total_paise, dispatches: order.dispatches },
      });
      return json({ error: 'quote_changed', quote: curateQuote(order) }, 409);
    }

    const orderType = order.order_type;
    const grandTotal = order.grand_total;

    // ── Razorpay: create the order BEFORE we touch our DB ─────
    let razorpayOrderId: string | null = null;
    if (payment_method === 'razorpay') {
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
          amount: order.total_paise,
          currency: 'INR',
          receipt: `1stone_${user.id.slice(0, 8)}_${Date.now()}`,
          notes: { user_id: user.id, order_type: orderType },
        }),
      });
      const rzpOrder = await rzpRes.json();
      if (!rzpOrder.id) return json({ error: 'Payment gateway error', details: rzpOrder }, 502);
      razorpayOrderId = rzpOrder.id;
    }

    // ── Wallet debit (atomic, only if sufficient) — ONE debit ──
    let walletAmountUsed = 0;
    if (payment_method === 'wallet') {
      const { data: debited, error: debitError } = await supabase.rpc(
        'decrement_wallet_balance_if_sufficient',
        { p_user_id: user.id, p_amount: grandTotal, p_description: 'Order payment' },
      );
      if (debitError) throw new Error(`Wallet debit RPC failed: ${debitError.message}`);
      if (debited !== true) return json({ error: 'Insufficient wallet balance' }, 400);
      walletAmountUsed = grandTotal;
    }

    // ── Insert all orders + items atomically ──────────────────
    const orderStatus = payment_method === 'razorpay' ? 'Pending' : 'Confirmed';
    const pGroups = order.groups.map((g) => ({
      cycle_id: g.cycle_id,
      dispatch_date: g.dispatch_date,
      total_amount: g.total_amount,
      tax_amount: g.tax_amount,
      delivery_fee: g.delivery_fee,
      wallet_amount_used: payment_method === 'wallet' ? g.total_amount : 0,
      items: g.items,
    }));

    const { data: createdRows, error: rpcError } = await supabase.rpc('place_order_atomic', {
      p_user_id: user.id,
      p_status: orderStatus,
      p_order_type: orderType,
      p_delivery_method: order.delivery_method,
      p_hub_id: order.hub_id,
      p_payment_method: payment_method,
      p_razorpay_order_id: razorpayOrderId,
      p_delivery_address_id: delivery_address_id,
      p_notes: notes || null,
      p_branch_id: order.branch_id,
      p_groups: pGroups,
    });

    if (rpcError || !createdRows || (createdRows as any[]).length === 0) {
      // Roll back the wallet debit if the orders could not be persisted.
      if (payment_method === 'wallet' && walletAmountUsed > 0) {
        let refundFailed = false;
        let refundErrMessage = '';
        try {
          const { error: refundErr } = await supabase.rpc('increment_wallet_balance', {
            p_user_id: user.id,
            p_amount: walletAmountUsed,
            p_description: 'Order placement failed — refund',
          });
          if (refundErr) { refundFailed = true; refundErrMessage = refundErr.message; }
        } catch (e: any) {
          refundFailed = true; refundErrMessage = e?.message ?? String(e);
        }
        if (refundFailed) {
          const ref = new Date().toISOString();
          console.error('[place-order] WALLET REFUND FAILED — manual reconciliation needed', {
            user_id: user.id, amount: walletAmountUsed,
            original_error: rpcError?.message ?? 'unknown',
            refund_error: refundErrMessage, reference: ref,
          });
          return json({
            error: `Order failed and we could not auto-refund your wallet. Our team has been notified — please contact support with this reference: ${ref}`,
          }, 500);
        }
      }
      throw new Error(`place_order_atomic failed: ${rpcError?.message ?? 'unknown'}`);
    }

    const rows = createdRows as Array<{ new_order_id: number; new_group_id: string }>;
    const orderIds = rows.map((r) => r.new_order_id);
    const orderGroupId = rows[0].new_group_id;
    const primaryOrderId = orderIds[0];

    // ── Create user_subscriptions rows for any plans in this order ──
    for (const plan of order.loaded_plans) {
      const start = order.plan_start_by_id[plan.id];
      const { error: subErr } = await supabase.from('user_subscriptions').insert({
        user_id: user.id,
        plan_id: plan.id,
        start_date: start,
        days_consumed: 0,
        is_active: payment_method === 'wallet',
        is_paused: false,
        payment_method,
        wallet_amount_used: 0,
        razorpay_order_id: razorpayOrderId,
        branch_id: plan.branch_id ?? null,
      });
      if (subErr) {
        console.error('[place-order] user_subscriptions insert failed:', {
          plan_id: plan.id, order_id: primaryOrderId, error: subErr.message,
        });
      }
    }

    const responsePayload = {
      id: primaryOrderId,
      order_group_id: orderGroupId,
      order_ids: orderIds,
      status: orderStatus,
      total_amount: grandTotal,
      razorpay_order_id: razorpayOrderId,
      payment_method,
      wallet_amount_used: walletAmountUsed,
      subscription_count: order.loaded_plans.length,
    };

    // ── Cache the response under the idempotency key (rule 5) ──
    // Written ONLY here, on success — a 409/4xx above never consumes the key.
    if (idempotencyKey) {
      await supabase.from('idempotency_keys').insert({
        key: idempotencyKey,
        user_id: user.id,
        endpoint: 'place-order',
        response: responsePayload,
      });
    }

    // ── Push (wallet orders are immediately Confirmed) ─────────
    if (payment_method === 'wallet') {
      resolveAndSendPush({
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
        eventKey: 'order.confirmed',
        userIds: [user.id],
        vars: { order_id: primaryOrderId },
        fallback: {
          title: 'Order Confirmed!',
          body: `Your order #${primaryOrderId} is confirmed. We are getting it ready!`,
        },
        data: { screen: 'OrderDetail', params: { orderId: primaryOrderId } },
        referenceId: String(orderGroupId),
      }).catch((e) => console.error('[place-order] push failed:', e));
    }

    return json(responsePayload, 200);
  } catch (err: any) {
    return json({ error: err.message ?? 'Internal server error' }, 500);
  }
});
