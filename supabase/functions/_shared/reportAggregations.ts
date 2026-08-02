/**
 * 1stOne F1 — Report aggregations (pure functions).
 *
 * Lifted VERBATIM from the device hooks (src/hooks/useReports.ts and
 * useHubReport.ts) as part of Task 3C — moving report calculations off the
 * device. The `reports` Edge Function fetches the rows and calls these; the
 * client hooks now only call that function.
 *
 * Every function is pure (rows in → shaped result out) and the logic is an
 * exact copy of the previous on-device code, so report numbers do not change.
 * Covered by src/__tests__/reportAggregations.test.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Revenue report ───────────────────────────────────────────
export function aggregateRevenue(orders: any[]) {
  // Group by date
  const dailyMap: Record<string, { date: string; revenue: number; count: number }> = {};
  let totalRevenue = 0;
  let totalTax = 0;
  let totalDeliveryFees = 0;
  let totalOrders = 0;

  for (const o of orders) {
    const d = o.dispatch_date;
    if (!dailyMap[d]) {
      dailyMap[d] = { date: d, revenue: 0, count: 0 };
    }
    dailyMap[d].revenue += o.total_amount;
    dailyMap[d].count += 1;
    totalRevenue += o.total_amount;
    totalTax += o.tax_amount ?? 0;
    totalDeliveryFees += o.delivery_fee ?? 0;
    totalOrders += 1;
  }

  // Payment method breakdown
  const paymentBreakdown: Record<string, number> = {};
  for (const o of orders) {
    const method = o.payment_method || 'unknown';
    paymentBreakdown[method] = (paymentBreakdown[method] || 0) + o.total_amount;
  }

  return {
    daily: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
    totalRevenue,
    totalTax,
    totalDeliveryFees,
    totalOrders,
    avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    paymentBreakdown,
  };
}

// ── Order report ─────────────────────────────────────────────
export function aggregateOrders(orders: any[]) {
  // By status
  const statusBreakdown: Record<string, number> = {};
  for (const o of orders) {
    statusBreakdown[o.status ?? 'unknown'] = (statusBreakdown[o.status ?? 'unknown'] || 0) + 1;
  }

  // By cycle
  const cycleBreakdown: Record<number, number> = {};
  for (const o of orders) {
    cycleBreakdown[o.cycle_id ?? 0] = (cycleBreakdown[o.cycle_id ?? 0] || 0) + 1;
  }

  // By type
  const typeBreakdown: Record<string, number> = {};
  for (const o of orders) {
    typeBreakdown[o.order_type ?? 'unknown'] = (typeBreakdown[o.order_type ?? 'unknown'] || 0) + 1;
  }

  // Daily counts
  const dailyMap: Record<string, number> = {};
  for (const o of orders) {
    dailyMap[o.dispatch_date] = (dailyMap[o.dispatch_date] || 0) + 1;
  }

  const cancellationRate = orders.length > 0
    ? ((statusBreakdown['Cancelled'] || 0) / orders.length) * 100
    : 0;

  return {
    total: orders.length,
    statusBreakdown,
    cycleBreakdown,
    typeBreakdown,
    daily: Object.entries(dailyMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    cancellationRate,
  };
}

// ── Subscription report ──────────────────────────────────────
// `all` rows + the two head-count results are fetched by the caller.
export function aggregateSubscriptions(
  all: any[],
  activeCount: number,
  cancelledDaysCount: number,
) {
  const active = activeCount;
  const paused = all.filter((s) => s.is_paused).length;
  const cancelled = all.filter((s) => !s.is_active && !s.is_paused).length;
  const totalSkippedDays = cancelledDaysCount;

  // By payment method
  const paymentBreakdown: Record<string, number> = {};
  for (const s of all) {
    const method = s.payment_method || 'unknown';
    paymentBreakdown[method] = (paymentBreakdown[method] || 0) + 1;
  }

  return {
    total: all.length,
    active,
    paused,
    cancelled,
    totalSkippedDays,
    paymentBreakdown,
  };
}

// ── Staff attendance report ──────────────────────────────────
export function aggregateStaffAttendance(records: any[]) {
  // Per-staff summary
  const staffMap: Record<string, {
    name: string;
    daysPresent: number;
    totalHours: number;
  }> = {};

  for (const r of records) {
    const id = r.staff_id ?? 'unknown';
    if (!staffMap[id]) {
      staffMap[id] = {
        name: r.profiles?.full_name || r.profiles?.phone_number || id,
        daysPresent: 0,
        totalHours: 0,
      };
    }
    if (r.clock_in_time) {
      staffMap[id].daysPresent += 1;
      if (r.clock_out_time) {
        const hrs = (new Date(r.clock_out_time).getTime() - new Date(r.clock_in_time).getTime()) / 3600000;
        staffMap[id].totalHours += hrs;
      }
    }
  }

  return {
    totalRecords: records.length,
    staffSummary: Object.entries(staffMap).map(([id, summary]) => ({
      staffId: id,
      ...summary,
      avgHoursPerDay: summary.daysPresent > 0 ? summary.totalHours / summary.daysPresent : 0,
    })),
  };
}

// ── Orders detail report ─────────────────────────────────────
export function aggregateOrdersDetail(orders: any[]) {
  const cycleMap: Record<string, { date: string; cycleName: string; count: number }> = {};
  const menuMap: Record<string, { date: string; itemName: string; qty: number }> = {};

  for (const o of orders) {
    // Subscription-purchase orders carry cycle_id=NULL by design (they pay
    // for a whole plan, not a specific dispatch). Without this branch the
    // fallback rendered them as the literal string "Cycle null", which
    // looked like a bug. Surfacing them under their own label keeps
    // parity with the customer's My Orders history while making the
    // operational vs. revenue distinction readable.
    const cycleName =
      o.cycle_id == null
        ? 'Subscription Purchase'
        : (o.delivery_cycles?.cycle_name ?? `Cycle ${o.cycle_id}`);
    const ck = `${o.dispatch_date}__${cycleName}`;
    if (!cycleMap[ck]) cycleMap[ck] = { date: o.dispatch_date, cycleName, count: 0 };
    cycleMap[ck].count++;

    for (const oi of (o.order_items ?? []) as any[]) {
      const mk = `${o.dispatch_date}__${oi.item_name}`;
      if (!menuMap[mk]) menuMap[mk] = { date: o.dispatch_date, itemName: oi.item_name, qty: 0 };
      menuMap[mk].qty += oi.quantity;
    }
  }

  return {
    totalOrders: orders.length,
    cycleRows: Object.values(cycleMap).sort((a, b) => b.date.localeCompare(a.date)),
    menuRows: Object.values(menuMap).sort((a, b) => b.date.localeCompare(a.date)),
  };
}

// ── Revenue detail report ────────────────────────────────────
/**
 * Money a third-party vendor's goods brought in, split out from our own.
 *
 * WHY THIS EXISTS. Revenue was `SUM(orders.total_amount)` with no vendor
 * awareness anywhere in the reporting path, so a vendor's sale counted as OUR
 * revenue at its full gross value. On a ₹100 vendor sale at 15% commission our
 * actual income is ₹15 — the report said ₹100. Nothing on screen would have
 * looked wrong, which is what makes it worth splitting rather than caveating.
 *
 * `vendorSales` is money we COLLECT but mostly pass on: it is the customer's
 * payment for someone else's goods. `vendorCommission` is the part we keep.
 *
 * COMMISSION IS REALISED ON DELIVERY, not on order. It comes from
 * vendor_earnings, written by the credit-on-delivery trigger, so a period
 * holding vendor orders that have not been delivered yet shows their sales
 * value but not the commission still to come. That is honest rather than
 * convenient — booking commission on an order that may still be cancelled
 * would overstate income, which is the very thing this is fixing.
 */
export interface VendorSplitInput {
  /** order_id → merchandise value of VENDOR-owned lines in that order. */
  vendorValueByOrder: Record<number, number>;
  /** Commission credited to us for these orders, from vendor_earnings. */
  commission: number;
}

function emptySplit(): VendorSplitInput {
  return { vendorValueByOrder: {}, commission: 0 };
}

export function aggregateRevenueDetail(orders: any[], split: VendorSplitInput = emptySplit()) {
  const dayMap: Record<
    string,
    { date: string; orders: number; revenue: number; tax: number; vendorSales: number }
  > = {};
  for (const o of orders) {
    if (!dayMap[o.dispatch_date])
      dayMap[o.dispatch_date] = {
        date: o.dispatch_date, orders: 0, revenue: 0, tax: 0, vendorSales: 0,
      };
    dayMap[o.dispatch_date].orders++;
    dayMap[o.dispatch_date].revenue += o.total_amount ?? 0;
    dayMap[o.dispatch_date].tax += o.tax_amount ?? 0;
    dayMap[o.dispatch_date].vendorSales += split.vendorValueByOrder[o.id] ?? 0;
  }

  const rows = Object.values(dayMap).sort((a, b) => b.date.localeCompare(a.date));
  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
      tax: acc.tax + r.tax,
      vendorSales: acc.vendorSales + r.vendorSales,
    }),
    { orders: 0, revenue: 0, tax: 0, vendorSales: 0 },
  );

  return {
    rows,
    totals,
    vendor: {
      /** Customer money taken for vendor goods. Collected, largely passed on. */
      sales: totals.vendorSales,
      /** Our cut of the above — realised only once delivered. */
      commission: split.commission,
      /** Everything that is not a vendor's goods: our items, fees, tax. */
      ownRevenue: totals.revenue - totals.vendorSales,
      /**
       * What the business actually earned: our own takings plus commission.
       * This is the number to read as "revenue" once vendors are selling —
       * `totals.revenue` is gross collections, which is a different question.
       */
      netRevenue: totals.revenue - totals.vendorSales + split.commission,
    },
  };
}

// ── Subscription plan-wise report ────────────────────────────
export function aggregateSubscriptionPlans(all: any[]) {
  const planMap: Record<string, { planName: string; active: number; paused: number; cancelled: number }> = {};
  for (const s of all) {
    const planName = s.subscription_plans?.plan_name ?? `Plan ${s.plan_id}`;
    const key = String(s.plan_id);
    if (!planMap[key]) planMap[key] = { planName, active: 0, paused: 0, cancelled: 0 };
    if (s.is_active && !s.is_paused) planMap[key].active++;
    else if (s.is_paused) planMap[key].paused++;
    else planMap[key].cancelled++;
  }
  return Object.values(planMap);
}

// ── Expense claims report ────────────────────────────────────
export function aggregateExpenses(claims: any[]) {
  const totalAmount = claims.reduce((s, c) => s + (c.amount ?? 0), 0);
  const approved = claims.filter((c) => c.status === 'Approved');
  const pending = claims.filter((c) => c.status === 'Pending');
  const rejected = claims.filter((c) => c.status === 'Rejected');

  // By category
  const categoryBreakdown: Record<string, number> = {};
  for (const c of claims) {
    const cat = c.category ?? 'unknown';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + (c.amount ?? 0);
  }

  return {
    total: claims.length,
    totalAmount,
    approvedAmount: approved.reduce((s, c) => s + (c.amount ?? 0), 0),
    pendingAmount: pending.reduce((s, c) => s + (c.amount ?? 0), 0),
    rejectedAmount: rejected.reduce((s, c) => s + (c.amount ?? 0), 0),
    approvedCount: approved.length,
    pendingCount: pending.length,
    rejectedCount: rejected.length,
    categoryBreakdown,
  };
}

// ── Hub report ───────────────────────────────────────────────
export interface HubStat {
  hub_id: number;
  hub_name: string;
  total_orders: number;
  dispatched: number;
  received_at_hub: number;
  on_the_way: number;
  delivered: number;
  pending: number;
  cancelled: number;
  revenue: number;
  commission_percent: number | null;
  commission_due: number;
}

export function aggregateHubReport(orders: any[]) {
  const hubMap = new Map<number, HubStat>();

  for (const o of orders) {
    const hid: number = o.hub_id;
    if (hid == null) continue;

    if (!hubMap.has(hid)) {
      hubMap.set(hid, {
        hub_id: hid,
        hub_name: o.delivery_hubs?.hub_name ?? `Hub #${hid}`,
        total_orders: 0,
        dispatched: 0,
        received_at_hub: 0,
        on_the_way: 0,
        delivered: 0,
        pending: 0,
        cancelled: 0,
        revenue: 0,
        commission_percent: o.delivery_hubs?.commission_percent ?? null,
        commission_due: 0,
      });
    }

    const stat = hubMap.get(hid)!;
    stat.total_orders += 1;
    stat.revenue += o.total_amount ?? 0;

    // Only delivered orders count toward commission payout.
    if (o.status === 'Delivered' && stat.commission_percent != null) {
      stat.commission_due += (o.total_amount ?? 0) * (stat.commission_percent / 100);
    }

    switch (o.status) {
      case 'Dispatched':       stat.dispatched += 1; break;
      case 'Received at Hub':  stat.received_at_hub += 1; break;
      case 'On the Way':       stat.on_the_way += 1; break;
      case 'Delivered':        stat.delivered += 1; break;
      case 'Cancelled':        stat.cancelled += 1; break;
      default:                 stat.pending += 1; break;
    }
  }

  const stats = Array.from(hubMap.values()).sort((a, b) =>
    b.total_orders - a.total_orders,
  );

  const totals = stats.reduce(
    (acc, s) => ({
      total_orders: acc.total_orders + s.total_orders,
      delivered: acc.delivered + s.delivered,
      revenue: acc.revenue + s.revenue,
      pending: acc.pending + s.pending,
    }),
    { total_orders: 0, delivered: 0, revenue: 0, pending: 0 },
  );

  return { hubs: stats, totals };
}

// ── Return-type aliases (consumed by the client report hooks) ──
export type RevenueReport = ReturnType<typeof aggregateRevenue>;
export type OrderReport = ReturnType<typeof aggregateOrders>;
export type SubscriptionReport = ReturnType<typeof aggregateSubscriptions>;
export type StaffAttendanceReport = ReturnType<typeof aggregateStaffAttendance>;
export type OrdersDetailReport = ReturnType<typeof aggregateOrdersDetail>;
export type RevenueDetailReport = ReturnType<typeof aggregateRevenueDetail>;
export type SubscriptionPlanReport = ReturnType<typeof aggregateSubscriptionPlans>;
export type ExpenseReport = ReturnType<typeof aggregateExpenses>;
export type HubReportResult = ReturnType<typeof aggregateHubReport>;
