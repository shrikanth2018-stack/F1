/**
 * 1stOne F1 — Cancel Order (Edge Function)
 *
 * Input:  { order_id }
 * Guards:
 *   - Order must belong to the authenticated user
 *   - Status must be Pending / Confirmed / Preparing (not yet in kitchen/dispatched)
 *   - Must be within cancellation_window_hours from store_config
 * Actions:
 *   - Set order status → 'Cancelled'
 *   - Refund wallet_amount_used back to wallet (if any)
 *   - Razorpay portion is noted in response; manual refund handled by admin
 *
 * Idempotency: if the order is already 'Cancelled', returns success immediately
 * (the DB status IS the idempotency record — no second refund is issued).
 *
 * Deploy: supabase functions deploy cancel-order --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CANCELLABLE_STATUSES = new Set(['Pending', 'Confirmed', 'Preparing']);

/** Returns today + tomorrow as YYYY-MM-DD strings in IST, plus current time in minutes. */
export function istDateInfo(): { todayStr: string; tomorrowStr: string; nowMins: number } {
  const now = new Date();

  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = dateFmt.format(now);

  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = dateFmt.format(tomorrowDate);

  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const h = Number(timeParts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(timeParts.find((p) => p.type === 'minute')?.value ?? '0');

  return { todayStr, tomorrowStr, nowMins: h * 60 + m };
}

Deno.serve(async (req: Request) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const ALLOWED_ORIGINS = new Set([SUPABASE_URL, 'http://localhost:8081', 'http://localhost:19006']);
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

  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Server misconfigured' }, 500);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const { order_id } = await req.json();
    if (!order_id) return json({ error: 'order_id is required' }, 400);

    // Load order — must belong to this user
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, user_id, status, payment_method, total_amount, wallet_amount_used, created_at, cycle_id, dispatch_date')
      .eq('id', order_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (orderErr) throw orderErr;
    if (!order) return json({ error: 'Order not found' }, 404);

    // ── Idempotency guard ──────────────────────────────────────
    // If the order is already cancelled, return success without re-processing.
    // This prevents a double-refund if the client retries after a network drop.
    if (order.status === 'Cancelled') {
      const walletRefund = Number(order.wallet_amount_used) || 0;
      const razorpayRefundDue = Math.max(0, Number(order.total_amount) - walletRefund);
      return json({
        status: 'cancelled',
        wallet_refunded: walletRefund,
        razorpay_refund_due: razorpayRefundDue,
        idempotent: true,
      });
    }

    // Status check
    if (!CANCELLABLE_STATUSES.has(order.status)) {
      return json({
        error: `Order cannot be cancelled — it is already ${order.status}.`,
      }, 409);
    }

    // ── Parallel: load config + cycle cutoff ──────────────────
    const [configRes, cycleRes] = await Promise.all([
      supabase.from('store_config').select('cancellation_window_hours').limit(1).maybeSingle(),
      order.cycle_id
        ? supabase.from('delivery_cycles').select('cutoff_time, delivery_start').eq('id', order.cycle_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // Guard 1: cancellation window from order creation time
    const windowHours: number = configRes.data?.cancellation_window_hours ?? 2;
    const ageMs = Date.now() - new Date(order.created_at).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    if (ageHours > windowHours) {
      return json({
        error: `Cancellation window of ${windowHours}h has passed. Contact support for help.`,
      }, 409);
    }

    // Guard 2: cycle cutoff — once the kitchen receives the order, it cannot be cancelled.
    //
    // Cross-midnight cycles (e.g. cutoff 22:30, delivery 07:00 next day):
    //   cutoff_time > delivery_start → dispatch_date is TOMORROW when cutoff fires TONIGHT.
    //   We must block if dispatch_date == tomorrow AND cutoff has passed tonight.
    //
    // Same-day cycles (e.g. cutoff 11:00, delivery 13:00 same day):
    //   dispatch_date == TODAY and cutoff has passed.
    const cycleData = (cycleRes as any).data;
    const cutoffTime: string | null = cycleData?.cutoff_time ?? null;
    const deliveryStart: string | null = cycleData?.delivery_start ?? null;

    if (cutoffTime && order.dispatch_date) {
      const { todayStr, tomorrowStr, nowMins } = istDateInfo();

      const [cutH, cutM] = cutoffTime.split(':').map(Number);
      const cutoffMins = cutH * 60 + cutM;
      const cutoffPassed = nowMins >= cutoffMins;

      // Cross-midnight: cutoff_time lexicographically > delivery_start (both HH:MM:SS)
      const isCrossMidnight = deliveryStart ? cutoffTime > deliveryStart : false;

      const blockedSameDay       = !isCrossMidnight && order.dispatch_date === todayStr    && cutoffPassed;
      const blockedCrossMidnight =  isCrossMidnight && order.dispatch_date === tomorrowStr && cutoffPassed;

      if (blockedSameDay || blockedCrossMidnight) {
        return json({
          error: 'Order cannot be cancelled — the kitchen has already received today\'s orders.',
        }, 409);
      }
    }

    // Cancel the order
    const { error: cancelErr } = await supabase
      .from('orders')
      .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
      .eq('id', order_id)
      .eq('user_id', user.id);

    if (cancelErr) throw cancelErr;

    // Wallet refund (if any)
    const walletRefund = Number(order.wallet_amount_used) || 0;
    if (walletRefund > 0) {
      const { error: refundErr } = await supabase.rpc('increment_wallet_balance', {
        p_user_id: user.id,
        p_amount: walletRefund,
        p_description: `Refund for cancelled order #${order_id}`,
      });
      if (refundErr) {
        console.error('[cancel-order] Wallet refund failed:', refundErr.message);
        // Order is already cancelled — log but don't fail. Admin can manually refund.
      }
    }

    const razorpayRefundDue = Math.max(0, Number(order.total_amount) - walletRefund);
    console.log(`[cancel-order] Order ${order_id} cancelled. Wallet refund: ${walletRefund}, Razorpay refund due: ${razorpayRefundDue}`);

    return json({
      status: 'cancelled',
      wallet_refunded: walletRefund,
      razorpay_refund_due: razorpayRefundDue,
    });

  } catch (err: any) {
    console.error('[cancel-order] Unhandled error:', err?.message);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
