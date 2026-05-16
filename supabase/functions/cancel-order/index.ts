/**
 * 1stOne F1 — Cancel Order (Edge Function)
 *
 * MF-10: a customer-facing "order" is an order GROUP — one or more
 * `orders` rows sharing an order_group_id, one row per dispatch cycle.
 * A customer cancellation cancels the WHOLE group in a single action.
 *
 * Input:  { order_id }   — any row of the group
 * Guards:
 *   - The order must belong to the authenticated user
 *   - At least one row must still be in a cancellable status
 *   - Within cancellation_window_hours of creation
 *   - The EARLIEST dispatch cycle's cutoff must not have passed —
 *     the "1st item cutoff" governs the whole group (once the kitchen
 *     has the first cycle, the order locks)
 * Actions:
 *   - Every still-cancellable row in the group → 'Cancelled'
 *   - Refund the SUM of those rows' wallet_amount_used to the wallet
 *     (per-row money model — each row carries its own real amount)
 *   - Razorpay portion is noted in the response; manual admin refund
 *
 * Idempotency: if every row in the group is already 'Cancelled',
 * returns success without re-processing (no second refund).
 *
 * Deploy: supabase functions deploy cancel-order --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';

// 'Paid' = Razorpay webhook confirmed but kitchen hasn't started yet — still cancellable
const CANCELLABLE_STATUSES = new Set(['Pending', 'Confirmed', 'Paid', 'Preparing']);

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

    const user = getUserFromJwt(authHeader.replace('Bearer ', ''));
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { order_id } = await req.json();
    if (!order_id) return json({ error: 'order_id is required' }, 400);

    // ── Resolve the order group from the passed row ────────────
    const { data: anchor, error: anchorErr } = await supabase
      .from('orders')
      .select('id, user_id, order_group_id')
      .eq('id', order_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (anchorErr) throw anchorErr;
    if (!anchor) return json({ error: 'Order not found' }, 404);

    // ── Load every row in the group ────────────────────────────
    const { data: groupRows, error: groupErr } = await supabase
      .from('orders')
      .select('id, status, payment_method, total_amount, wallet_amount_used, created_at, cycle_id, dispatch_date, branch_id')
      .eq('order_group_id', anchor.order_group_id)
      .eq('user_id', user.id);

    if (groupErr) throw groupErr;
    if (!groupRows || groupRows.length === 0) return json({ error: 'Order not found' }, 404);

    const sumWallet = (rows: any[]) => rows.reduce((s, r) => s + (Number(r.wallet_amount_used) || 0), 0);
    const sumTotal  = (rows: any[]) => rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);

    // ── Idempotency guard ──────────────────────────────────────
    // Whole group already cancelled — return success, no second refund.
    if (groupRows.every((r) => r.status === 'Cancelled')) {
      const walletRefund = sumWallet(groupRows);
      return json({
        status: 'cancelled',
        wallet_refunded: walletRefund,
        razorpay_refund_due: Math.max(0, sumTotal(groupRows) - walletRefund),
        idempotent: true,
      });
    }

    // Rows we can still cancel (skip already-Cancelled — already refunded).
    const cancellable = groupRows.filter((r) => CANCELLABLE_STATUSES.has(r.status));
    if (cancellable.length === 0) {
      const blocking = groupRows.find((r) => r.status !== 'Cancelled');
      return json({
        error: `Order cannot be cancelled — it is already ${blocking?.status ?? 'in progress'}.`,
      }, 409);
    }

    // ── Guard 1: cancellation window from creation ─────────────
    const { data: configRow } = await supabase
      .from('store_config').select('cancellation_window_hours').limit(1).maybeSingle();
    const windowHours: number = configRow?.cancellation_window_hours ?? 2;
    const earliestCreated = Math.min(...groupRows.map((r) => new Date(r.created_at).getTime()));
    const ageHours = (Date.now() - earliestCreated) / (1000 * 60 * 60);

    if (ageHours > windowHours) {
      return json({
        error: `Cancellation window of ${windowHours}h has passed. Contact support for help.`,
      }, 409);
    }

    // ── Guard 2: earliest dispatch cycle's cutoff ──────────────
    // The "1st item" cutoff governs the whole group: once the earliest
    // cycle's kitchen window closes, the order can no longer be cancelled.
    const cycleIds = [...new Set(groupRows.map((r) => r.cycle_id).filter((c) => c != null))];
    let cyclesById = new Map<number, any>();
    if (cycleIds.length > 0) {
      const { data: cycleRows } = await supabase
        .from('delivery_cycles')
        .select('id, cutoff_time, delivery_start')
        .in('id', cycleIds);
      cyclesById = new Map((cycleRows ?? []).map((c: any) => [c.id, c]));
    }

    // Earliest row: min dispatch_date, tie-break on the cycle's cutoff_time.
    const sortedRows = [...groupRows].sort((a, b) => {
      if (a.dispatch_date !== b.dispatch_date) {
        return a.dispatch_date < b.dispatch_date ? -1 : 1;
      }
      const ca = cyclesById.get(a.cycle_id)?.cutoff_time ?? '99:99';
      const cb = cyclesById.get(b.cycle_id)?.cutoff_time ?? '99:99';
      return ca < cb ? -1 : ca > cb ? 1 : 0;
    });
    const earliest = sortedRows[0];
    const earliestCycle = cyclesById.get(earliest.cycle_id);

    if (earliestCycle?.cutoff_time && earliest.dispatch_date) {
      const { todayStr, tomorrowStr, nowMins } = istDateInfo();

      const [cutH, cutM] = earliestCycle.cutoff_time.split(':').map(Number);
      const cutoffMins = cutH * 60 + cutM;
      const cutoffPassed = nowMins >= cutoffMins;

      // Cross-midnight: cutoff_time lexicographically > delivery_start.
      const isCrossMidnight = earliestCycle.delivery_start
        ? earliestCycle.cutoff_time > earliestCycle.delivery_start : false;

      const blockedSameDay       = !isCrossMidnight && earliest.dispatch_date === todayStr    && cutoffPassed;
      const blockedCrossMidnight =  isCrossMidnight && earliest.dispatch_date === tomorrowStr && cutoffPassed;

      if (blockedSameDay || blockedCrossMidnight) {
        return json({
          error: 'Order cannot be cancelled — the kitchen has already received today\'s orders.',
        }, 409);
      }
    }

    // ── Cancel every cancellable row in the group ──────────────
    const cancellableIds = cancellable.map((r) => r.id);
    const { error: cancelErr } = await supabase
      .from('orders')
      .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
      .in('id', cancellableIds)
      .eq('user_id', user.id);

    if (cancelErr) throw cancelErr;

    // ── Wallet refund — sum over the rows we just cancelled ────
    const walletRefund = sumWallet(cancellable);
    if (walletRefund > 0) {
      const { error: refundErr } = await supabase.rpc('increment_wallet_balance', {
        p_user_id: user.id,
        p_amount: walletRefund,
        p_description: `Refund for cancelled order #${anchor.id}`,
      });
      if (refundErr) {
        // BF-39 (F1.5): the order(s) are already Cancelled (atomic from the
        // customer's perspective) but the wallet refund didn't credit.
        // Loud structured log + role-targeted push to branch admins so
        // reconciliation is human-visible. Do not throw — the cancel succeeded.
        const ref = new Date().toISOString();
        console.error('[cancel-order] [REFUND-FAILURE-ALERT] Wallet refund failed', {
          order_group_id: anchor.order_group_id, order_id: anchor.id,
          user_id: user.id, amount: walletRefund, reason: refundErr.message, reference: ref,
        });

        fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            role: 'admin',
            branch_id: cancellable[0]?.branch_id ?? undefined,
            event_key: 'admin.wallet_refund_failed',
            vars: { order_id: anchor.id, amount: walletRefund, reference: ref },
            title: 'Wallet refund failed',
            body: `Order #${anchor.id} cancelled but wallet refund of ₹${walletRefund} did not credit. Manual reconciliation needed (ref ${ref}).`,
            data: { screen: 'AdminOrderDetail', params: { orderId: anchor.id } },
            trigger_source: 'admin_alert',
            reference_id: String(anchor.id),
          }),
        }).catch((e: any) =>
          console.error('[cancel-order] admin alert push failed:', e?.message),
        );
      }
    }

    const razorpayRefundDue = Math.max(0, sumTotal(cancellable) - walletRefund);
    console.log(`[cancel-order] Group ${anchor.order_group_id} cancelled (${cancellableIds.length} row(s)). Wallet refund: ${walletRefund}, Razorpay refund due: ${razorpayRefundDue}`);

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
