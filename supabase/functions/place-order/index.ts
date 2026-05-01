/**
 * 1stOne F1 — Place Order Edge Function
 *
 * Handles food + essentials items in one order.
 *
 * Rules (do not weaken without agreement):
 *   1. Order status starts at 'Pending' for razorpay; moves to 'Paid' via
 *      verify-payment webhook. Wallet payments start at 'Confirmed' (debit
 *      already succeeded atomically).
 *   2. Wallet debit uses decrement_wallet_balance_if_sufficient RPC — never
 *      read-modify-write at this layer.
 *   3. Orders + order_items insert is a single atomic RPC (place_order_atomic).
 *   4. Idempotency-Key header is enforced: duplicate keys return the cached
 *      response instead of creating a second order.
 *   5. delivery_method and hub_id are derived from the address server-side,
 *      never trusted from the client payload.
 *
 * Deploy: supabase functions deploy place-order --no-verify-jwt
 *
 * Body:
 *   food_items:       [{ menu_item_id, quantity }]         (optional)
 *   essentials_items: [{ essential_item_id, quantity }]    (optional)
 *   delivery_address_id, payment_method, dispatch_date, notes, cycle_id
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';
import { resolveAndSendPush } from '../_shared/notifications.ts';

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
    // If the same user has sent this key before, return the cached response.
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
      food_items = [],
      essentials_items = [],
      items: legacy_items = [],
      subscription_plans = [],
      cycle_id,
      delivery_address_id,
      payment_method,
      dispatch_date,
      notes,
    } = body;

    const foodItems = food_items.length > 0 ? food_items : legacy_items;

    if (foodItems.length === 0 && essentials_items.length === 0 && subscription_plans.length === 0) {
      return json({ error: 'No items or plans provided' }, 400);
    }

    // ── Store config + storm mode ──────────────────────────────
    const { data: config } = await supabase
      .from('store_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    // Storm-mode kill switch (feature_flags row wins if set)
    const { data: stormFlag } = await supabase
      .from('feature_flags')
      .select('flag_value')
      .eq('flag_key', 'storm_mode_active')
      .maybeSingle();

    const stormActive = stormFlag?.flag_value === true || config?.storm_mode_active === true;
    if (stormActive) {
      return json(
        { error: 'Orders are temporarily paused. Please try again shortly.' },
        403,
      );
    }

    const taxRate = config?.tax_rate_percentage ?? 5;

    // ── Address, zone, hub (server-derived) ───────────────────
    const { data: addressData } = await supabase
      .from('customer_addresses')
      .select('zone_id, hub_id, branch_id')
      .eq('id', delivery_address_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!addressData) return json({ error: 'Invalid delivery address' }, 400);

    // Delivery fee priority: hub override → zone override → store default.
    // Hub wins because hubs are the final dispatch point and may carry extra cost
    // (e.g. external contractor markup). Both overrides are nullable.
    let deliveryFee = config?.delivery_fee ?? 0;
    if (addressData.zone_id != null) {
      const { data: zone } = await supabase
        .from('delivery_zones')
        .select('delivery_fee_override')
        .eq('id', addressData.zone_id)
        .maybeSingle();
      if (zone?.delivery_fee_override != null) deliveryFee = zone.delivery_fee_override;
    }
    if (addressData.hub_id != null) {
      const { data: hub } = await supabase
        .from('delivery_hubs')
        .select('delivery_fee_override')
        .eq('id', addressData.hub_id)
        .maybeSingle();
      if ((hub as any)?.delivery_fee_override != null) deliveryFee = (hub as any).delivery_fee_override;
    }

    const deliveryMethod = addressData.hub_id != null ? 'hub' : 'direct';
    const hubId = addressData.hub_id ?? null;
    const branchId = addressData.branch_id ?? null;

    // ── Price from DB (never trust client) ────────────────────
    let subtotal = 0;
    const orderItemRows: any[] = [];
    let resolvedCycleId = cycle_id ?? null;

    if (foodItems.length > 0) {
      const foodIds = foodItems.map((i: any) => i.menu_item_id);
      const { data: menuItems, error: menuError } = await supabase
        .from('menu_items')
        .select('id, name, price, is_active')
        .in('id', foodIds);
      if (menuError) throw menuError;

      const menuMap = new Map(menuItems!.map((m) => [m.id, m]));
      for (const item of foodItems) {
        const m = menuMap.get(item.menu_item_id);
        if (!m || !m.is_active) return json({ error: `Item ${item.menu_item_id} unavailable` }, 400);
        subtotal += m.price * item.quantity;
        orderItemRows.push({
          item_id: item.menu_item_id,
          item_type: 'food',
          item_name: m.name,
          quantity: item.quantity,
          price_at_time: m.price,
        });
      }
    }

    if (essentials_items.length > 0) {
      const essIds = essentials_items.map((i: any) => i.essential_item_id);
      const { data: essRows, error: essError } = await supabase
        .from('essentials_catalog')
        .select('id, name, price, is_active, cycle_id')
        .in('id', essIds);
      if (essError) throw essError;

      const essMap = new Map(essRows!.map((e) => [e.id, e]));
      for (const item of essentials_items) {
        const e = essMap.get(item.essential_item_id);
        if (!e || !e.is_active) return json({ error: `Essential ${item.essential_item_id} unavailable` }, 400);
        subtotal += e.price * item.quantity;
        if (!resolvedCycleId && e.cycle_id) resolvedCycleId = e.cycle_id;
        orderItemRows.push({
          item_id: item.essential_item_id,
          item_type: 'essential',
          item_name: e.name,
          quantity: item.quantity,
          price_at_time: e.price,
        });
      }
    }

    // ── Subscription plans: validate + core-items conflict + add to subtotal ──
    const planStartById = new Map<number, string>();
    const loadedPlans: any[] = [];
    if (subscription_plans.length > 0) {
      const planIds = subscription_plans.map((sp: any) => sp.plan_id);
      const { data: planRows, error: planErr } = await supabase
        .from('subscription_plans')
        .select('id, plan_name, price, duration_days, cycle_id, plan_type, is_active, plan_items, branch_id')
        .in('id', planIds);
      if (planErr) throw planErr;

      for (const sp of subscription_plans) {
        const plan = planRows?.find((p: any) => p.id === sp.plan_id);
        if (!plan || !plan.is_active) {
          return json({ error: `Plan ${sp.plan_id} unavailable` }, 400);
        }
        if (!sp.start_date) {
          return json({ error: `start_date required for plan ${sp.plan_id}` }, 400);
        }
        loadedPlans.push(plan);
        planStartById.set(plan.id, sp.start_date);
      }

      // ── Core-items + date-range conflict check ───────────────
      // Blueprint: two plans with the same core item are allowed when the
      // new plan is QUEUED (its date range does not overlap the existing sub).
      // A real conflict = item overlap AND date overlap; queued plans pass.
      const { data: activeSubs } = await supabase
        .from('user_subscriptions')
        .select('id, start_date, subscription_plans ( plan_type, plan_items, duration_days )')
        .eq('user_id', user.id)
        .eq('is_active', true);

      const parseItemIds = (raw: unknown): Set<number> => {
        let arr: any[] = [];
        if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = []; } }
        else if (Array.isArray(raw)) arr = raw;
        const ids = new Set<number>();
        for (const it of arr) if (typeof it?.item_id === 'number') ids.add(it.item_id);
        return ids;
      };

      const MS_PER_DAY = 86_400_000;
      for (const newPlan of loadedPlans) {
        const newType = newPlan.plan_type ?? 'food';
        const newIds = parseItemIds(newPlan.plan_items);
        if (newIds.size === 0) continue;

        const newStartStr = planStartById.get(newPlan.id)!;
        const newStartMs = new Date(newStartStr).getTime();
        const newEndMs = newStartMs + (newPlan.duration_days - 1) * MS_PER_DAY;

        for (const existing of activeSubs ?? []) {
          const ep: any = (existing as any).subscription_plans;
          if (!ep) continue;
          if ((ep.plan_type ?? 'food') !== newType) continue;

          const exStartMs = new Date((existing as any).start_date).getTime();
          const exEndMs = exStartMs + ((ep.duration_days ?? 0) - 1) * MS_PER_DAY;

          // Ranges must overlap for a conflict to be possible.
          // (newStart > existingEnd) OR (existingStart > newEnd) → queued → allow
          if (newEndMs < exStartMs || exEndMs < newStartMs) continue;

          // Ranges overlap — now check if any core item_id collides.
          const existingIds = parseItemIds(ep.plan_items);
          for (const id of newIds) {
            if (existingIds.has(id)) {
              return json({
                error: `"${newPlan.plan_name}" overlaps an active subscription delivering the same item during these dates.`,
              }, 409);
            }
          }
        }
      }

      // Roll plan prices into subtotal + order lines so the customer receipt shows them
      for (const plan of loadedPlans) {
        subtotal += plan.price;
        orderItemRows.push({
          item_id: plan.id,
          item_type: 'subscription',
          item_name: plan.plan_name,
          quantity: 1,
          price_at_time: plan.price,
        });
        if (!resolvedCycleId && plan.cycle_id) resolvedCycleId = plan.cycle_id;
      }
    }

    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const totalAmount = Math.round((subtotal + taxAmount + deliveryFee) * 100) / 100;
    // orderType: items drive it when present; else infer from first plan's type
    const orderType = foodItems.length > 0 || loadedPlans.some((p) => (p.plan_type ?? 'food') === 'food')
      ? 'food'
      : 'essential';

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
          amount: Math.round(totalAmount * 100),
          currency: 'INR',
          receipt: `1stone_${user.id.slice(0, 8)}_${Date.now()}`,
          notes: { user_id: user.id, order_type: orderType },
        }),
      });
      const rzpOrder = await rzpRes.json();
      if (!rzpOrder.id) return json({ error: 'Payment gateway error', details: rzpOrder }, 502);
      razorpayOrderId = rzpOrder.id;
    }

    // ── Wallet debit (atomic, only if sufficient) ─────────────
    let walletAmountUsed = 0;
    if (payment_method === 'wallet') {
      const { data: debited, error: debitError } = await supabase.rpc(
        'decrement_wallet_balance_if_sufficient',
        {
          p_user_id: user.id,
          p_amount: totalAmount,
          p_description: 'Order payment',
        },
      );
      if (debitError) throw new Error(`Wallet debit RPC failed: ${debitError.message}`);
      if (debited !== true) return json({ error: 'Insufficient wallet balance' }, 400);
      walletAmountUsed = totalAmount;
    }

    // ── Insert order + items atomically ───────────────────────
    // Status:
    //   razorpay → 'Pending' (verify-payment webhook flips to 'Paid')
    //   wallet   → 'Confirmed' (payment already settled)
    const orderStatus = payment_method === 'razorpay' ? 'Pending' : 'Confirmed';

    const { data: newOrderId, error: rpcError } = await supabase.rpc('place_order_atomic', {
      p_user_id: user.id,
      p_total_amount: totalAmount,
      p_tax_amount: taxAmount,
      p_delivery_fee: deliveryFee,
      p_status: orderStatus,
      p_order_type: orderType,
      p_dispatch_date: dispatch_date,
      p_cycle_id: resolvedCycleId,
      p_delivery_method: deliveryMethod,
      p_hub_id: hubId,
      p_payment_method: payment_method,
      p_razorpay_order_id: razorpayOrderId,
      p_wallet_amount_used: walletAmountUsed,
      p_delivery_address_id: delivery_address_id,
      p_notes: notes || null,
      p_branch_id: branchId,
      p_items: orderItemRows,
    });

    if (rpcError || !newOrderId) {
      // Rollback wallet debit if the order could not be persisted
      if (payment_method === 'wallet' && walletAmountUsed > 0) {
        let refundFailed = false;
        let refundErrMessage = '';
        try {
          const { error: refundErr } = await supabase.rpc('increment_wallet_balance', {
            p_user_id: user.id,
            p_amount: walletAmountUsed,
            p_description: 'Order placement failed — refund',
          });
          if (refundErr) {
            refundFailed = true;
            refundErrMessage = refundErr.message;
          }
        } catch (e: any) {
          refundFailed = true;
          refundErrMessage = e?.message ?? String(e);
        }
        if (refundFailed) {
          // Wallet was debited, order insert failed, refund also failed — money is
          // sitting unrecoverable. Log loud so support can manually reconcile.
          const ref = new Date().toISOString();
          console.error('[place-order] WALLET REFUND FAILED — manual reconciliation needed', {
            user_id: user.id,
            amount: walletAmountUsed,
            original_error: rpcError?.message ?? 'unknown',
            refund_error: refundErrMessage,
            reference: ref,
          });
          return json({
            error: `Order failed and we could not auto-refund your wallet. Our team has been notified — please contact support with this reference: ${ref}`,
          }, 500);
        }
      }
      throw new Error(`place_order_atomic failed: ${rpcError?.message ?? 'unknown'}`);
    }

    // ── Create user_subscriptions rows for any plans in this order ──
    // Wallet path: is_active=true immediately (payment already settled).
    // Razorpay path: is_active=false + razorpay_order_id matching the order —
    // verify-payment webhook flips them active on payment.captured using
    // razorpay_order_id (existing logic, unchanged).
    for (const plan of loadedPlans) {
      const start = planStartById.get(plan.id);
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
        // Non-blocking — order is already live. Log for manual reconciliation.
        console.error('[place-order] user_subscriptions insert failed:', {
          plan_id: plan.id, order_id: newOrderId, error: subErr.message,
        });
      }
    }

    const responsePayload = {
      id: newOrderId,
      status: orderStatus,
      total_amount: totalAmount,
      razorpay_order_id: razorpayOrderId,
      payment_method,
      wallet_amount_used: walletAmountUsed,
      subscription_count: loadedPlans.length,
    };

    // ── Cache the response under the idempotency key ──────────
    if (idempotencyKey) {
      await supabase.from('idempotency_keys').insert({
        key: idempotencyKey,
        user_id: user.id,
        endpoint: 'place-order',
        response: responsePayload,
      });
    }

    // ── Push notification (wallet orders are immediately Confirmed) ──
    // Razorpay orders start as Pending — push fires when verify-payment confirms them.
    if (payment_method === 'wallet') {
      resolveAndSendPush({
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
        eventKey: 'order.confirmed',
        userIds: [user.id],
        vars: { order_id: newOrderId },
        fallback: {
          title: 'Order Confirmed!',
          body: `Your order #${newOrderId} is confirmed. We are getting it ready!`,
        },
        data: { screen: 'OrderDetail', params: { orderId: newOrderId } },
        referenceId: String(newOrderId),
      }).catch((e) => console.error('[place-order] push failed:', e));
    }

    return json(responsePayload, 200);
  } catch (err: any) {
    return json({ error: err.message ?? 'Internal server error' }, 500);
  }
});
