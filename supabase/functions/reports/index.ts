/**
 * 1stOne F1 — Reports (server-side report aggregation)
 *
 * Admin-only. Fetches the rows for a given report and returns the aggregated
 * result via _shared/reportAggregations.ts — the SAME aggregation logic that
 * used to run on the device. The client report hooks (useReports /
 * useHubReport) now only call this function; no report math runs on-device.
 *
 * Body: { report, start_date?, end_date?, branch_id?, source? }
 *   branch_id: number | null — when non-null, rows are filtered to that branch
 *   (the client passes the already-resolved branch filter value).
 *   source: 'all' | 'bulk' | 'retail' — narrows the ORDER-based reports by
 *   provenance. 'bulk' = created from the back office (orders.placed_by set),
 *   'retail' = placed by the customer themselves. Applied to the QUERY, not
 *   the aggregation, so reportAggregations.ts is untouched and the numbers
 *   for 'all' are byte-identical to before this filter existed.
 *
 * Deploy: supabase functions deploy reports --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';
import {
  aggregateRevenue,
  aggregateOrders,
  aggregateSubscriptions,
  aggregateStaffAttendance,
  aggregateOrdersDetail,
  aggregateRevenueDetail,
  aggregateSubscriptionPlans,
  aggregateExpenses,
  aggregateHubReport,
} from '../_shared/reportAggregations.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = new Set([
  SUPABASE_URL,
  'http://localhost:8081',
  'http://localhost:19006',
]);

Deno.serve(async (req) => {
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

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const user = await getUserFromJwt(authHeader.replace('Bearer ', ''));
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Admin gate — reports are an admin-only surface ─────────
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin') return json({ error: 'Forbidden' }, 403);

    const body = await req.json();
    const report: string = body?.report ?? '';
    const startDate: string = body?.start_date ?? '';
    const endDate: string = body?.end_date ?? '';
    const branchId: number | null = typeof body?.branch_id === 'number' ? body.branch_id : null;

    // Provenance filter for the order-based reports. Anything unrecognised
    // (including absent) falls back to 'all', so older app builds that don't
    // send the field keep getting exactly the report they got before.
    const source: 'all' | 'bulk' | 'retail' =
      body?.source === 'bulk' || body?.source === 'retail' ? body.source : 'all';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    /**
     * Work out how much of a set of orders was somebody else's goods.
     *
     * Three small reads rather than one join, because `order_items.item_id` is
     * polymorphic — it points at menu_items OR essentials_catalog depending on
     * `item_type`, so there is no foreign key for PostgREST to embed through.
     *
     * Cheap in practice: only essentials lines are fetched, and the vendor-item
     * id list is the whole vendor catalogue, which is tiny. Returns zeroes for
     * an empty period rather than issuing pointless queries.
     */
    const buildVendorSplit = async (sb: any, orderIds: number[]) => {
      const empty = { vendorValueByOrder: {} as Record<number, number>, commission: 0 };
      if (orderIds.length === 0) return empty;

      const { data: vendorItems } = await sb
        .from('essentials_catalog')
        .select('id')
        .not('vendor_id', 'is', null);
      const vendorItemIds = new Set<number>((vendorItems ?? []).map((r: any) => r.id));
      // No vendor sells anything yet — skip the rest, the answer is zero.
      if (vendorItemIds.size === 0) return empty;

      const { data: lines } = await sb
        .from('order_items')
        .select('order_id, item_id, quantity, price_at_time')
        .in('order_id', orderIds)
        .eq('item_type', 'essentials');

      const vendorValueByOrder: Record<number, number> = {};
      for (const l of lines ?? []) {
        if (!vendorItemIds.has(l.item_id)) continue;
        vendorValueByOrder[l.order_id] =
          (vendorValueByOrder[l.order_id] ?? 0) +
          (l.quantity ?? 0) * (l.price_at_time ?? 0);
      }

      // Commission we actually earned. vendor_earnings is written by the
      // credit-on-delivery trigger, so this covers delivered orders only —
      // deliberately, since an undelivered order can still be cancelled.
      const { data: earnings } = await sb
        .from('vendor_earnings')
        .select('commission_amount')
        .in('order_id', orderIds);
      const commission = (earnings ?? []).reduce(
        (s: number, e: any) => s + Number(e.commission_amount ?? 0),
        0,
      );

      return { vendorValueByOrder, commission };
    };

    const bySource = (q: any) =>
      source === 'bulk' ? q.not('placed_by', 'is', null)
        : source === 'retail' ? q.is('placed_by', null)
          : q;

    switch (report) {
      case 'revenue': {
        let q = supabase
          .from('orders')
          .select('id, total_amount, tax_amount, delivery_fee, dispatch_date, status, cycle_id, payment_method')
          .gte('dispatch_date', startDate)
          .lte('dispatch_date', endDate)
          .neq('status', 'Cancelled')
          .order('dispatch_date', { ascending: true });
        if (branchId != null) q = q.eq('branch_id', branchId);
        q = bySource(q);
        const { data, error } = await q;
        if (error) throw error;
        return json(aggregateRevenue(data ?? []));
      }

      case 'orders': {
        let q = supabase
          .from('orders')
          .select('id, status, cycle_id, order_type, dispatch_date')
          .gte('dispatch_date', startDate)
          .lte('dispatch_date', endDate)
          .order('dispatch_date', { ascending: true });
        if (branchId != null) q = q.eq('branch_id', branchId);
        q = bySource(q);
        const { data, error } = await q;
        if (error) throw error;
        return json(aggregateOrders(data ?? []));
      }

      case 'subscription': {
        let activeQ = supabase
          .from('user_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .eq('is_paused', false);
        let allQ = supabase
          .from('user_subscriptions')
          .select('id, is_active, is_paused, plan_id, payment_method, created_at');
        let cancelledDaysQ = supabase
          .from('cancelled_subscription_days')
          .select('id', { count: 'exact', head: true });
        if (branchId != null) {
          activeQ = activeQ.eq('branch_id', branchId);
          allQ = allQ.eq('branch_id', branchId);
          cancelledDaysQ = cancelledDaysQ.eq('branch_id', branchId);
        }
        const [activeRes, allRes, cancelledDaysRes] = await Promise.all([activeQ, allQ, cancelledDaysQ]);
        if (allRes.error) throw allRes.error;
        return json(aggregateSubscriptions(
          allRes.data ?? [],
          activeRes.count ?? 0,
          cancelledDaysRes.count ?? 0,
        ));
      }

      case 'staffAttendance': {
        let q = supabase
          .from('staff_attendance')
          .select('*, profiles!staff_attendance_staff_id_fkey(full_name, phone_number)')
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: true });
        if (branchId != null) q = q.eq('branch_id', branchId);
        const { data, error } = await q;
        if (error) throw error;
        return json(aggregateStaffAttendance(data ?? []));
      }

      case 'ordersDetail': {
        let q = supabase
          .from('orders')
          .select('id, dispatch_date, cycle_id, delivery_cycles(cycle_name), order_items(item_name, quantity)')
          .gte('dispatch_date', startDate)
          .lte('dispatch_date', endDate)
          .neq('status', 'Cancelled')
          .order('dispatch_date', { ascending: false });
        if (branchId != null) q = q.eq('branch_id', branchId);
        q = bySource(q);
        const { data, error } = await q;
        if (error) throw error;
        return json(aggregateOrdersDetail(data ?? []));
      }

      case 'revenueDetail': {
        let q = supabase
          .from('orders')
          .select('id, dispatch_date, total_amount, tax_amount')
          .gte('dispatch_date', startDate)
          .lte('dispatch_date', endDate)
          .neq('status', 'Cancelled')
          .order('dispatch_date', { ascending: false });
        if (branchId != null) q = q.eq('branch_id', branchId);
        q = bySource(q);
        const { data, error } = await q;
        if (error) throw error;

        const split = await buildVendorSplit(supabase, (data ?? []).map((o: any) => o.id));
        return json(aggregateRevenueDetail(data ?? [], split));
      }

      case 'subscriptionPlan': {
        let q = supabase
          .from('user_subscriptions')
          .select('id, is_active, is_paused, plan_id, subscription_plans(plan_name)');
        if (branchId != null) q = q.eq('branch_id', branchId);
        const { data, error } = await q;
        if (error) throw error;
        return json(aggregateSubscriptionPlans(data ?? []));
      }

      case 'expense': {
        let q = supabase
          .from('expense_claims')
          .select('*')
          .gte('created_at', `${startDate}T00:00:00`)
          .lte('created_at', `${endDate}T23:59:59`)
          .order('created_at', { ascending: false });
        if (branchId != null) q = q.eq('branch_id', branchId);
        const { data, error } = await q;
        if (error) throw error;
        return json(aggregateExpenses(data ?? []));
      }

      case 'hub': {
        let q = supabase
          .from('orders')
          .select('id, total_amount, status, delivery_method, hub_id, dispatch_date, branch_id, delivery_hubs!orders_hub_id_fkey(hub_name, commission_percent)')
          .eq('delivery_method', 'hub')
          .gte('dispatch_date', startDate)
          .lte('dispatch_date', endDate)
          .order('dispatch_date', { ascending: false });
        if (branchId != null) q = q.eq('branch_id', branchId);
        const { data, error } = await q;
        if (error) throw error;
        return json(aggregateHubReport(data ?? []));
      }

      default:
        return json({ error: `Unknown report: ${report}` }, 400);
    }
  } catch (err: any) {
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
