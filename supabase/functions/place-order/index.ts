/**
 * 1stOne F1 — Place Order Edge Function
 *
 * Handles food + essentials items in one order. MF-10: a single
 * checkout can span multiple delivery cycles / days — each (cycle,
 * dispatch_date) becomes its own `orders` row (a single-cycle
 * fulfillment unit), all sharing one order_group_id.
 *
 * Rules (do not weaken without agreement):
 *   1. Order status starts at 'Pending' for razorpay; moves to
 *      'Confirmed' via confirm-order / verify-payment. Wallet payments
 *      start at 'Confirmed' (debit already succeeded atomically).
 *   2. Wallet debit uses decrement_wallet_balance_if_sufficient RPC —
 *      never read-modify-write at this layer. ONE debit for the whole
 *      checkout (grand total across all groups).
 *   3. All orders + order_items for the checkout are inserted in a
 *      single atomic RPC (place_order_atomic, multi-group signature).
 *   4. Idempotency-Key header is enforced: duplicate keys return the
 *      cached response instead of creating a second order.
 *   5. delivery_method and hub_id are derived from the address
 *      server-side, never trusted from the client payload.
 *   6. Each cart item's cycle is re-derived from the DB and validated
 *      against the group it was placed in — the client cannot
 *      mis-group an item into the wrong cycle.
 *   7. Money is per-row: each group carries its own subtotal + tax;
 *      the delivery fee is charged ONCE, on the earliest-dispatch
 *      group. So SUM(orders.total_amount) stays correct.
 *
 * Deploy: supabase functions deploy place-order --no-verify-jwt
 * NOTE: the payload shape changed for MF-10 — deploy this together
 * with the matching app build, never alone.
 *
 * Body:
 *   groups: [{ cycle_id, dispatch_date,
 *              food_items:[{menu_item_id,quantity}],
 *              essentials_items:[{essential_item_id,quantity}] }]
 *   subscription_plans: [{ plan_id, start_date }]   (optional)
 *   dispatch_date        (optional — used only for a subscription order)
 *   delivery_address_id, payment_method, notes
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
      groups = [],
      subscription_plans = [],
      cycle_id: legacy_cycle_id,
      delivery_address_id,
      payment_method,
      dispatch_date,
      notes,
    } = body;

    if ((!Array.isArray(groups) || groups.length === 0) && subscription_plans.length === 0) {
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

    // ── Build dispatch groups (price from DB — never trust client) ──
    // Each group: one cycle + one dispatch_date + its own item rows.
    type DispatchGroup = {
      cycle_id: number | null;
      dispatch_date: string;
      items: any[];
      subtotal: number;
    };
    const dispatchGroups: DispatchGroup[] = [];

    for (const g of groups) {
      const groupCycleId: number | null = g.cycle_id ?? null;
      const groupDate: string | undefined = g.dispatch_date;
      const foodItems = g.food_items ?? [];
      const essItems = g.essentials_items ?? [];

      if (!groupDate) return json({ error: 'dispatch_date is required for every group' }, 400);

      const items: any[] = [];
      let subtotal = 0;

      if (foodItems.length > 0) {
        const foodIds = foodItems.map((i: any) => i.menu_item_id);
        const { data: menuItems, error: menuError } = await supabase
          .from('menu_items')
          .select('id, name, price, is_active, cycle_id')
          .in('id', foodIds);
        if (menuError) throw menuError;

        const menuMap = new Map(menuItems!.map((m) => [m.id, m]));
        for (const item of foodItems) {
          const m = menuMap.get(item.menu_item_id);
          if (!m || !m.is_active) return json({ error: `Item ${item.menu_item_id} unavailable` }, 400);
          // Server-authoritative cycle check — the item's real cycle must
          // match the group it was placed in. Blocks the mis-scheduling bug.
          if (m.cycle_id !== groupCycleId) {
            return json({ error: `"${m.name}" cannot be ordered in the selected delivery cycle` }, 400);
          }
          subtotal += m.price * item.quantity;
          items.push({
            item_id: m.id,
            item_type: 'food',
            item_name: m.name,
            quantity: item.quantity,
            price_at_time: m.price,
          });
        }
      }

      if (essItems.length > 0) {
        const essIds = essItems.map((i: any) => i.essential_item_id);
        const { data: essRows, error: essError } = await supabase
          .from('essentials_catalog')
          .select('id, name, price, is_active, cycle_id')
          .in('id', essIds);
        if (essError) throw essError;

        const essMap = new Map(essRows!.map((e) => [e.id, e]));
        for (const item of essItems) {
          const e = essMap.get(item.essential_item_id);
          if (!e || !e.is_active) return json({ error: `Essential ${item.essential_item_id} unavailable` }, 400);
          if (e.cycle_id !== groupCycleId) {
            return json({ error: `"${e.name}" cannot be ordered in the selected delivery cycle` }, 400);
          }
          subtotal += e.price * item.quantity;
          items.push({
            item_id: e.id,
            item_type: 'essential',
            item_name: e.name,
            quantity: item.quantity,
            price_at_time: e.price,
          });
        }
      }

      if (items.length === 0) continue;
      dispatchGroups.push({ cycle_id: groupCycleId, dispatch_date: groupDate, items, subtotal });
    }

    // ── Subscription plans: validate + core-items conflict + own group ──
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

      // Subscription purchase is a single revenue record — one group.
      // Its dispatch_date is just the purchase day; the daily meal
      // dispatches are generated later by generate_daily_manifest.
      const subItems: any[] = [];
      let subSubtotal = 0;
      let subCycleId: number | null = legacy_cycle_id ?? null;
      for (const plan of loadedPlans) {
        subSubtotal += plan.price;
        subItems.push({
          item_id: plan.id,
          item_type: 'subscription',
          item_name: plan.plan_name,
          quantity: 1,
          price_at_time: plan.price,
        });
        if (!subCycleId && plan.cycle_id) subCycleId = plan.cycle_id;
      }
      dispatchGroups.push({
        cycle_id: subCycleId,
        dispatch_date: dispatch_date ?? new Date().toISOString().split('T')[0],
        items: subItems,
        subtotal: subSubtotal,
      });
    }

    if (dispatchGroups.length === 0) {
      return json({ error: 'No valid items to order' }, 400);
    }

    // ── Money: per-group, delivery fee charged once on earliest group ──
    let earliestIdx = 0;
    for (let i = 1; i < dispatchGroups.length; i++) {
      if (dispatchGroups[i].dispatch_date < dispatchGroups[earliestIdx].dispatch_date) {
        earliestIdx = i;
      }
    }

    const groupPayloads = dispatchGroups.map((g, idx) => {
      const tax = Math.round(g.subtotal * (taxRate / 100) * 100) / 100;
      const fee = idx === earliestIdx ? deliveryFee : 0;
      const total = Math.round((g.subtotal + tax + fee) * 100) / 100;
      return {
        cycle_id: g.cycle_id,
        dispatch_date: g.dispatch_date,
        items: g.items,
        tax_amount: tax,
        delivery_fee: fee,
        total_amount: total,
      };
    });

    const grandTotal = Math.round(
      groupPayloads.reduce((s, g) => s + g.total_amount, 0) * 100,
    ) / 100;

    // orderType: food when any food item or food plan is present; else essential.
    const hasFoodItem = dispatchGroups.some((g) => g.items.some((it) => it.item_type === 'food'));
    const hasFoodPlan = loadedPlans.some((p) => (p.plan_type ?? 'food') === 'food');
    const orderType = hasFoodItem || hasFoodPlan ? 'food' : 'essential';

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
          amount: Math.round(grandTotal * 100),
          currency: 'INR',
          receipt: `1stone_${user.id.slice(0, 8)}_${Date.now()}`,
          notes: { user_id: user.id, order_type: orderType },
        }),
      });
      const rzpOrder = await rzpRes.json();
      if (!rzpOrder.id) return json({ error: 'Payment gateway error', details: rzpOrder }, 502);
      razorpayOrderId = rzpOrder.id;
    }

    // ── Wallet debit (atomic, only if sufficient) — ONE debit for the checkout ──
    let walletAmountUsed = 0;
    if (payment_method === 'wallet') {
      const { data: debited, error: debitError } = await supabase.rpc(
        'decrement_wallet_balance_if_sufficient',
        {
          p_user_id: user.id,
          p_amount: grandTotal,
          p_description: 'Order payment',
        },
      );
      if (debitError) throw new Error(`Wallet debit RPC failed: ${debitError.message}`);
      if (debited !== true) return json({ error: 'Insufficient wallet balance' }, 400);
      walletAmountUsed = grandTotal;
    }

    // ── Insert all orders + items atomically ──────────────────
    // Status:
    //   razorpay → 'Pending' (confirm-order / verify-payment flips to 'Confirmed')
    //   wallet   → 'Confirmed' (payment already settled)
    // Per-group wallet_amount_used: the group's own total for wallet
    // payments, 0 for razorpay (the per-row money model — each row is
    // self-describing for refunds).
    const orderStatus = payment_method === 'razorpay' ? 'Pending' : 'Confirmed';

    const pGroups = groupPayloads.map((g) => ({
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
      p_delivery_method: deliveryMethod,
      p_hub_id: hubId,
      p_payment_method: payment_method,
      p_razorpay_order_id: razorpayOrderId,
      p_delivery_address_id: delivery_address_id,
      p_notes: notes || null,
      p_branch_id: branchId,
      p_groups: pGroups,
    });

    if (rpcError || !createdRows || (createdRows as any[]).length === 0) {
      // Rollback wallet debit if the orders could not be persisted
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

    const rows = createdRows as Array<{
      new_order_id: number;
      new_group_id: string;
      new_cycle_id: number | null;
      new_dispatch_date: string;
    }>;
    const orderIds = rows.map((r) => r.new_order_id);
    const orderGroupId = rows[0].new_group_id;
    const primaryOrderId = orderIds[0];

    // ── Create user_subscriptions rows for any plans in this order ──
    // Wallet path: is_active=true immediately (payment already settled).
    // Razorpay path: is_active=false + razorpay_order_id matching the order —
    // confirm-order / verify-payment flips them active on payment.
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
    // One push per checkout (the whole order group), not one per row.
    // Razorpay orders start as Pending — push fires when payment confirms them.
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
