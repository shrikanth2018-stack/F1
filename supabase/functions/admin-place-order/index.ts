/**
 * 1stOne F1 — Admin / Bulk Place Order (server-authoritative, admin-only)
 *
 * Back-office order entry. An admin creates an order ON BEHALF OF a customer
 * — bulk, individual or B2B — for ONE delivery cycle, from menu items and
 * priced building-block items.
 *
 * This is a SEPARATE endpoint from `place-order` on purpose. The customer
 * path's rules block (place-order/index.ts) is a contract; branching it on
 * "is this an admin?" would be a new way to weaken it by accident. What the
 * two share is the derivation: both call buildAuthoritativeOrder from
 * _shared/orderBuild.ts, so pricing, GST carve-out, cycle grouping, dispatch
 * dates, fee priority, storm mode and serviceability behave identically.
 *
 * What differs from the customer path, deliberately:
 *   - no quote-echo / drift tripwire — the admin fixes the price at creation
 *     and no customer is watching a live quote
 *   - no 5-per-60s rate limit — it would block bulk entry
 *   - an admin-entered discount (item subtotal only, never the delivery fee)
 *     and an optional delivery-fee override, both range-checked server-side
 *   - the order is created BEFORE payment is taken. Confirmation does not
 *     depend on payment here, so there is no compensating transaction: a
 *     failed wallet debit simply leaves the order unpaid and says so.
 *
 * Unchanged invariants:
 *   - the client sends item ids + quantities; every PRICE is read from the DB
 *   - the client never sends a date; it sends an intent ('auto' |
 *     'current_run') and the server resolves it in IST
 *   - storm mode is honoured; there is no admin bypass
 *   - the wallet moves only through decrement_wallet_balance_if_sufficient
 *
 * Deploy: supabase functions deploy admin-place-order --no-verify-jwt
 * Requires: supabase/sql/admin_bulk_orders.sql applied first.
 *
 * Customer + address registration is NOT here — it lives in
 * `admin-create-customer`, so this function has exactly one job and there is
 * no second create-on-the-fly path to keep in sync. The address it uses must
 * already resolve to a zone or a hub; an order nobody can route is refused.
 *
 * Body:
 *   customer: { user_id, address_id? }   — both must already exist
 *   cycle_id, items: [{ item_id, quantity }]
 *   dispatch_target: 'auto' | 'current_run'
 *   discount_percent?, delivery_fee_override?
 *   payment_mode: 'wallet' | 'link' | 'account'
 *   notes?
 *   preview?: true — run every check and every calculation, return the
 *     figures, write NOTHING. The screen uses this so its confirmation
 *     dialog shows the real total rather than a device-side guess.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';
import { resolveAndSendPush } from '../_shared/notifications.ts';
import { buildAuthoritativeOrder } from '../_shared/orderBuild.ts';
import { loadStoreConfig } from '../_shared/storeConfig.ts';
import { resolveClock, getDispatchScenario, scenarioToDate, timeToMinutes, toPaise } from '../_shared/dispatch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RAZORPAY_KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const RAZORPAY_KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';

const ALLOWED_ORIGINS = new Set([
  SUPABASE_URL,
  'http://localhost:8081',
  'http://localhost:19006',
]);

const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') ?? '';
  const acao = ALLOWED_ORIGINS.has(origin) ? origin : SUPABASE_URL;
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
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = await getUserFromJwt(authHeader.replace('Bearer ', ''));
    if (!caller) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 1. Admin gate ──────────────────────────────────────────
    // Role lives in profiles.role (the JWT claim is minted from it). Read it
    // with the service client so a stale token cannot grant access.
    const { data: callerProfile, error: callerErr } = await supabase
      .from('profiles').select('role, branch_id').eq('id', caller.id).maybeSingle();
    if (callerErr) return json({ error: `Profile lookup failed: ${callerErr.message}` }, 500);
    if (callerProfile?.role !== 'admin') return json({ error: 'Admin role required' }, 403);

    const body = await req.json();
    const {
      customer = {},
      cycle_id,
      items = [],
      dispatch_target = 'auto',
      discount_percent = 0,
      delivery_fee_override = null,
      payment_mode = 'account',
      notes,
      preview = false,
    } = body ?? {};

    if (!cycle_id) return json({ error: 'cycle_id is required' }, 400);
    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: 'Add at least one item to the order.' }, 400);
    }
    if (!['wallet', 'link', 'account'].includes(payment_mode)) {
      return json({ error: 'Invalid payment mode' }, 400);
    }
    if (!['auto', 'current_run'].includes(dispatch_target)) {
      return json({ error: 'Invalid dispatch target' }, 400);
    }

    // ── 2. Config + discount bound ─────────────────────────────
    let config;
    try {
      config = await loadStoreConfig(supabase);
    } catch (_e) {
      return json({ error: 'Store configuration is unavailable. Please try again shortly.' }, 503);
    }
    const { data: cfgRow } = await supabase
      .from('store_config').select('max_admin_discount_percent').single();
    const maxDiscount = Number(cfgRow?.max_admin_discount_percent ?? 15);

    const discount = Number(discount_percent) || 0;
    if (discount < 0 || discount > maxDiscount) {
      return json({ error: `Discount must be between 0% and ${maxDiscount}%.` }, 400);
    }
    let feeOverride: number | null = null;
    if (delivery_fee_override !== null && delivery_fee_override !== undefined && delivery_fee_override !== '') {
      const f = Number(delivery_fee_override);
      if (!Number.isFinite(f) || f < 0) {
        return json({ error: 'Delivery charge must be zero or more.' }, 400);
      }
      feeOverride = round2(f);
    }

    // ── 3. The customer must already exist ─────────────────────
    // Customer + address registration lives in `admin-create-customer`, so
    // this function does exactly one thing: turn a KNOWN customer plus items
    // into a priced, routed, paid order. The screen sends a resolved
    // customer_id; there is no create-on-the-fly path here to keep in sync.
    const customerId: string | null = customer.user_id ?? null;
    if (!customerId) {
      return json({ error: 'Select or register the customer first.' }, 400);
    }
    const { data: customerProfile } = await supabase
      .from('profiles').select('id').eq('id', customerId).maybeSingle();
    if (!customerProfile) {
      return json({ error: 'That customer no longer exists.' }, 400);
    }

    // ── 4. Delivery address — existing, and it must ROUTE ──────
    // is_serviceable alone is NOT enough: a legacy or seeded address can
    // carry is_serviceable = true with neither zone_id nor hub_id, and an
    // order built on it has no driver and shows as "Unassigned" on the admin
    // board. Refuse it here and point the admin at the address screen.
    let addressId: number | null =
      customer.address_id != null ? Number(customer.address_id) : null;

    if (addressId == null) {
      const { data: addrs } = await supabase
        .from('customer_addresses')
        .select('id')
        .eq('user_id', customerId)
        .eq('is_active', true)
        .order('is_default', { ascending: false });
      addressId = addrs?.[0]?.id ?? null;
    }
    if (addressId == null) {
      return json({
        error: 'This customer has no delivery address. Add one from the customer screen.',
        needs_routing: true,
      }, 400);
    }

    const { data: addrRow } = await supabase
      .from('customer_addresses')
      .select('id, zone_id, hub_id')
      .eq('id', addressId)
      .eq('user_id', customerId)
      .maybeSingle();
    if (!addrRow) {
      return json({ error: 'That delivery address does not belong to this customer.' }, 400);
    }
    if (addrRow.zone_id == null && addrRow.hub_id == null) {
      return json({
        error: 'This address has no delivery zone or hub, so the order could not be routed. Fix the address first.',
        needs_routing: true,
      }, 400);
    }

    // ── 5. Server-authoritative derivation (shared builder) ────
    const now = new Date();
    const result = await buildAuthoritativeOrder({
      supabase,
      userId: customerId!,
      items: items.map((i: any) => ({
        item_id: Number(i.item_id),
        item_type: 'food' as const,
        quantity: Number(i.quantity),
      })),
      deliveryAddressId: addressId,
      now,
      // The admin's chosen cycle, handed to the builder rather than applied
      // after it. §6 below already collapsed every line into this cycle; the
      // difference is that the builder no longer needs each item to carry a
      // cycle of its own — building blocks (Sambar, Rice) have none since the
      // Menu Manager rebuild, and bulk orders are exactly what they are
      // priced for. It is also what permits a non-customer-visible item here
      // and nowhere else.
      overrideCycleId: Number(cycle_id),
    });
    if (!result.ok) return json({ error: result.error }, result.status);
    const order = result.order;

    // Storm mode is NOT bypassable from the back office — if the kitchen is
    // down it is down for bulk orders too.
    if (order.storm_mode) {
      return json({ error: 'Ordering is paused (storm mode). Turn it off to place this order.' }, 403);
    }
    if (!order.serviceable) {
      return json({
        error: 'That location is outside every delivery zone and hub. Move the pin, or choose the delivery area manually.',
      }, 400);
    }

    // ── 6. One order, one cycle — the ADMIN's chosen cycle ─────
    // On the customer path an item's own cycle_id decides when it goes out:
    // a Dinner dish is a Dinner dish. Back-office ordering is different — a
    // bulk customer asks for "50 chapatis with lunch" regardless of which
    // cycle chapati is catalogued under. So every line is collapsed into ONE
    // group delivered in the cycle the admin picked.
    //
    // What does NOT change: prices still come from the DB via the shared
    // builder, and the dispatch DATE is still derived server-side from the
    // chosen cycle's cutoff. The client sends a cycle id (an intent), never
    // a date. One group also keeps one order = one order number for invoicing.
    const { data: cyc } = await supabase
      .from('delivery_cycles')
      .select('id, cycle_name, cutoff_time, delivery_start, is_active')
      .eq('id', cycle_id)
      .maybeSingle();
    if (!cyc || cyc.is_active === false || !cyc.cutoff_time || !cyc.delivery_start) {
      return json({ error: 'That delivery cycle is not available.' }, 400);
    }

    const collapsedItems = order.groups.flatMap((g) => g.items);
    if (collapsedItems.length === 0) {
      return json({ error: 'No valid items to order.' }, 400);
    }

    // Dispatch date for the CHOSEN cycle, via the same A/B/C rule the
    // customer path uses — not inherited from whatever cycle the items
    // happen to be catalogued under.
    const clock = resolveClock(now);
    const scenario = getDispatchScenario(
      { cutoff_time: cyc.cutoff_time, delivery_start: cyc.delivery_start },
      clock.nowMinutes,
    );
    let dispatchDate = scenarioToDate(scenario, clock);
    let dispatchNote: string | null = null;

    // 'current_run' = the run whose cutoff has passed but whose kitchen
    // summary has NOT gone out yet. Once kitchen_push_log has a row for that
    // cycle+date the batch is with the kitchen, so the order rolls forward —
    // the kitchen is never handed a batch that changes under it.
    if (dispatch_target === 'current_run') {
      const isCrossMidnight =
        timeToMinutes(cyc.cutoff_time) > timeToMinutes(cyc.delivery_start);
      // The date this cycle would have dispatched on had the cutoff not
      // passed: today for a same-day cycle, tomorrow for a cross-midnight one.
      const candidate = scenarioToDate(isCrossMidnight ? 'B' : 'A', clock);

      if (candidate < dispatchDate) {
        const { data: pushed } = await supabase
          .from('kitchen_push_log')
          .select('id')
          .eq('cycle_id', cycle_id)
          .eq('push_date', candidate)
          .maybeSingle();
        if (pushed) {
          dispatchNote =
            'The kitchen summary for that run has already gone out, so this order goes to the next run.';
        } else {
          dispatchDate = candidate;
        }
      }
    }

    // ── 7. Money: discount the items, keep the fee whole ───────
    // Discounting the UNIT price (not the total) keeps order_items.price_at_time
    // equal to what was actually charged — so the invoice, the revenue reports
    // and the hub-commission base all agree, and the lines sum to the subtotal.
    const d = discount / 100;
    const pricedItems = collapsedItems.map((it) => ({
      ...it,
      price_at_time: round2(it.price_at_time * (1 - d)),
    }));
    const subtotal = round2(
      pricedItems.reduce((s, it) => s + it.price_at_time * it.quantity, 0),
    );
    // Order-level fee: the builder puts it on the earliest group, but with
    // every line collapsed into one group the address-resolved fee applies
    // once, here.
    const deliveryFee = feeOverride !== null ? feeOverride : order.delivery_fee;
    // T1 pricing: GST is carved OUT of the (discounted) inclusive subtotal,
    // never added on, and the delivery fee is outside it.
    const taxAmount = round2((subtotal * config.tax_rate_percentage) / (100 + config.tax_rate_percentage));
    const totalAmount = round2(subtotal + deliveryFee);

    // ── 8. Preview: same numbers, nothing written ──────────────
    // The device must never compute money, but the admin still needs to see
    // the real total before committing. Rather than duplicate the maths in
    // the client, the screen calls this endpoint with preview=true and gets
    // the figures from THIS code path — so what the confirmation dialog
    // shows is by construction what the order will be written with. Same
    // relationship quote-order has with place-order on the customer side.
    if (preview === true) {
      return json({
        preview: true,
        cycle_id: Number(cycle_id),
        cycle_name: cyc.cycle_name,
        dispatch_date: dispatchDate,
        dispatch_note: dispatchNote,
        item_count: pricedItems.length,
        unit_count: pricedItems.reduce((n, it) => n + it.quantity, 0),
        subtotal,
        discount_percent: discount,
        delivery_fee: deliveryFee,
        tax_amount: taxAmount,
        total_amount: totalAmount,
      }, 200);
    }

    // ── 9. Write the order ─────────────────────────────────────
    // 'account' = confirmed now, collected later. Confirmation deliberately
    // does not wait on payment here, which is why there is no rollback path
    // below: an unpaid order is a valid outcome, not a failure.
    const paymentMethod =
      payment_mode === 'wallet' ? 'wallet' : payment_mode === 'link' ? 'razorpay' : 'account';

    const { data: createdRows, error: rpcError } = await supabase.rpc('place_order_atomic', {
      p_user_id: customerId,
      p_status: 'Confirmed',
      p_order_type: order.order_type,
      p_delivery_method: order.delivery_method,
      p_hub_id: order.hub_id,
      p_payment_method: paymentMethod,
      p_razorpay_order_id: null,
      p_delivery_address_id: addressId,
      p_notes: notes || null,
      p_branch_id: order.branch_id,
      p_groups: [{
        cycle_id: Number(cycle_id),
        dispatch_date: dispatchDate,
        total_amount: totalAmount,
        tax_amount: taxAmount,
        delivery_fee: deliveryFee,
        wallet_amount_used: 0, // stamped after a successful debit, below
        items: pricedItems,
      }],
    });

    if (rpcError || !createdRows || (createdRows as any[]).length === 0) {
      throw new Error(`place_order_atomic failed: ${rpcError?.message ?? 'unknown'}`);
    }

    const rows = createdRows as Array<{ new_order_id: number; new_group_id: string }>;
    const orderId = rows[0].new_order_id;
    const orderGroupId = rows[0].new_group_id;

    // Provenance + the admin-entered discount, for the invoice and the
    // "Bulk only" filter on the admin orders list.
    await supabase
      .from('orders')
      .update({ placed_by: caller.id, discount_percent: discount > 0 ? discount : null })
      .eq('id', orderId);

    // ── 10. Payment ────────────────────────────────────────────
    let paymentState: 'paid' | 'unpaid' | 'link_sent' = 'unpaid';
    let paymentError: string | null = null;
    let paymentLinkUrl: string | null = null;

    if (payment_mode === 'wallet') {
      const { data: debited, error: debitErr } = await supabase.rpc(
        'decrement_wallet_balance_if_sufficient',
        { p_user_id: customerId, p_amount: totalAmount, p_description: `Order #${orderId}` },
      );
      if (debitErr) {
        paymentError = `Wallet debit failed: ${debitErr.message}`;
      } else if (debited !== true) {
        paymentError = 'Insufficient wallet balance — the order was created unpaid.';
      } else {
        await supabase
          .from('orders')
          .update({ wallet_amount_used: totalAmount, paid_at: new Date().toISOString() })
          .eq('id', orderId);
        // Idempotent — filters on reference_id IS NULL.
        await supabase.rpc('tag_wallet_debit_to_order', {
          p_user_id: customerId, p_order_id: orderId,
        });
        paymentState = 'paid';

        // The customer did not initiate this debit, so tell them. Anyone with
        // a wallet balance has used the app, so a push does reach them.
        resolveAndSendPush({
          supabase,
          supabaseUrl: SUPABASE_URL,
          serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
          eventKey: 'wallet.debited',
          userIds: [customerId!],
          vars: { amount: totalAmount, order_id: orderId },
          fallback: {
            title: 'Wallet Debited',
            body: `₹${totalAmount} was debited from your wallet for order #${orderId}.`,
          },
          data: { screen: 'OrderDetail', params: { orderId } },
          referenceId: String(orderId),
        }).catch((e: any) => console.error('[admin-place-order] wallet push failed:', e));
      }
    }

    if (payment_mode === 'link') {
      if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
        paymentError = 'Razorpay is not configured — the order was created unpaid.';
      } else {
        try {
          const { data: prof } = await supabase
            .from('profiles').select('full_name, phone_number').eq('id', customerId).maybeSingle();
          const digits = String(prof?.phone_number ?? '').replace(/\D/g, '');
          const contact = `+91${digits.slice(-10)}`;

          const rzpRes = await fetch('https://api.razorpay.com/v1/payment_links', {
            method: 'POST',
            // Bounded — a Razorpay stall must not hang order creation.
            signal: AbortSignal.timeout(15_000),
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)}`,
            },
            body: JSON.stringify({
              amount: toPaise(totalAmount),
              currency: 'INR',
              accept_partial: false,
              description: `1stOne order #${orderId}`,
              customer: { name: prof?.full_name ?? 'Customer', contact },
              // Razorpay sends the SMS. A customer created from the back
              // office has no app and therefore no push token, so this is
              // their only notification channel.
              notify: { sms: true, email: false },
              reminder_enable: true,
              notes: { order_id: String(orderId), user_id: customerId },
            }),
          });
          const link = await rzpRes.json();
          if (!link?.id) {
            paymentError = `Payment link could not be created: ${link?.error?.description ?? 'gateway error'}`;
          } else {
            await supabase
              .from('orders')
              .update({ razorpay_payment_link_id: link.id })
              .eq('id', orderId);
            paymentLinkUrl = link.short_url ?? null;
            paymentState = 'link_sent';
          }
        } catch (e: any) {
          paymentError = `Payment link could not be created: ${e?.message ?? 'network error'}`;
        }
      }
    }

    // ── 11. Customer order confirmation (best-effort) ──────────
    // Silently reaches nobody for a customer who has never opened the app —
    // that is expected and why the payment link carries the SMS.
    resolveAndSendPush({
      supabase,
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      eventKey: 'order.confirmed',
      userIds: [customerId!],
      vars: { order_id: orderId },
      fallback: {
        title: 'Order Confirmed!',
        body: `Your order #${orderId} is confirmed. We are getting it ready!`,
      },
      data: { screen: 'OrderDetail', params: { orderId } },
      referenceId: String(orderGroupId),
    }).catch((e: any) => console.error('[admin-place-order] confirm push failed:', e));

    return json({
      order_id: orderId,
      order_group_id: orderGroupId,
      customer_id: customerId,
      cycle_id: Number(cycle_id),
      cycle_name: cyc.cycle_name,
      dispatch_date: dispatchDate,
      dispatch_note: dispatchNote,
      subtotal,
      discount_percent: discount,
      delivery_fee: deliveryFee,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      payment_mode,
      payment_state: paymentState,
      payment_error: paymentError,
      payment_link_url: paymentLinkUrl,
    }, 200);
  } catch (err: any) {
    console.error('[admin-place-order] unhandled:', err?.message);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
