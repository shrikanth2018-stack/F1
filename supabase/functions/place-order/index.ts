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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const idempotencyKey = req.headers.get('Idempotency-Key') ?? '';

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );

    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
      cycle_id,
      delivery_address_id,
      payment_method,
      dispatch_date,
      notes,
    } = body;

    const foodItems = food_items.length > 0 ? food_items : legacy_items;

    if (foodItems.length === 0 && essentials_items.length === 0) {
      return json({ error: 'No items provided' }, 400);
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
        503,
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

    let deliveryFee = config?.delivery_fee ?? 0;
    if (addressData.zone_id != null) {
      const { data: zone } = await supabase
        .from('delivery_zones')
        .select('delivery_fee_override')
        .eq('id', addressData.zone_id)
        .maybeSingle();
      if (zone?.delivery_fee_override != null) deliveryFee = zone.delivery_fee_override;
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

    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const totalAmount = Math.round((subtotal + taxAmount + deliveryFee) * 100) / 100;
    const orderType = foodItems.length > 0 ? 'food' : 'essential';

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
        await supabase.rpc('increment_wallet_balance', {
          p_user_id: user.id,
          p_amount: walletAmountUsed,
          p_description: 'Order placement failed — refund',
        });
      }
      throw new Error(`place_order_atomic failed: ${rpcError?.message ?? 'unknown'}`);
    }

    const responsePayload = {
      id: newOrderId,
      status: orderStatus,
      total_amount: totalAmount,
      razorpay_order_id: razorpayOrderId,
      payment_method,
      wallet_amount_used: walletAmountUsed,
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

    return json(responsePayload, 200);
  } catch (err: any) {
    return json({ error: err.message ?? 'Internal server error' }, 500);
  }
});
