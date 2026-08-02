/**
 * Tests for the server-side report aggregations
 * (supabase/functions/_shared/reportAggregations.ts).
 *
 * These pure functions were lifted verbatim from the old on-device report
 * hooks (Task 3C). They had NO coverage before — these tests lock the
 * behaviour so a future change can't silently shift a report number.
 */

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
} from '../../supabase/functions/_shared/reportAggregations';

describe('aggregateRevenue', () => {
  it('sums revenue/tax/fees, groups daily, and breaks down by payment method', () => {
    const r = aggregateRevenue([
      { dispatch_date: '2026-05-02', total_amount: 100, tax_amount: 5, delivery_fee: 10, payment_method: 'wallet' },
      { dispatch_date: '2026-05-01', total_amount: 200, tax_amount: 10, delivery_fee: 0, payment_method: 'razorpay' },
      { dispatch_date: '2026-05-02', total_amount: 50, tax_amount: 2.5, delivery_fee: 0, payment_method: 'wallet' },
    ]);
    expect(r.totalRevenue).toBe(350);
    expect(r.totalTax).toBe(17.5);
    expect(r.totalDeliveryFees).toBe(10);
    expect(r.totalOrders).toBe(3);
    expect(r.avgOrderValue).toBeCloseTo(350 / 3);
    expect(r.paymentBreakdown).toEqual({ wallet: 150, razorpay: 200 });
    // daily sorted ascending by date
    expect(r.daily.map((d) => d.date)).toEqual(['2026-05-01', '2026-05-02']);
    expect(r.daily[1]).toEqual({ date: '2026-05-02', revenue: 150, count: 2 });
  });

  it('handles an empty set', () => {
    const r = aggregateRevenue([]);
    expect(r.totalRevenue).toBe(0);
    expect(r.avgOrderValue).toBe(0);
    expect(r.daily).toEqual([]);
  });
});

describe('aggregateOrders', () => {
  it('breaks down by status / cycle / type and computes cancellation rate', () => {
    const r = aggregateOrders([
      { status: 'Delivered', cycle_id: 1, order_type: 'food', dispatch_date: '2026-05-01' },
      { status: 'Cancelled', cycle_id: 1, order_type: 'food', dispatch_date: '2026-05-01' },
      { status: 'Delivered', cycle_id: 2, order_type: 'essential', dispatch_date: '2026-05-02' },
      { status: 'Confirmed', cycle_id: 2, order_type: 'food', dispatch_date: '2026-05-02' },
    ]);
    expect(r.total).toBe(4);
    expect(r.statusBreakdown).toEqual({ Delivered: 2, Cancelled: 1, Confirmed: 1 });
    expect(r.cycleBreakdown).toEqual({ 1: 2, 2: 2 });
    expect(r.typeBreakdown).toEqual({ food: 3, essential: 1 });
    expect(r.cancellationRate).toBe(25);
    expect(r.daily).toEqual([
      { date: '2026-05-01', count: 2 },
      { date: '2026-05-02', count: 2 },
    ]);
  });

  it('cancellation rate is 0 for an empty set', () => {
    expect(aggregateOrders([]).cancellationRate).toBe(0);
  });
});

describe('aggregateSubscriptions', () => {
  it('counts paused/cancelled from rows and uses passed-in head counts', () => {
    const all = [
      { is_active: true, is_paused: false, payment_method: 'wallet' },
      { is_active: true, is_paused: true, payment_method: 'wallet' },
      { is_active: false, is_paused: false, payment_method: 'razorpay' },
    ];
    const r = aggregateSubscriptions(all, 1, 7);
    expect(r.total).toBe(3);
    expect(r.active).toBe(1);
    expect(r.paused).toBe(1);
    expect(r.cancelled).toBe(1);
    expect(r.totalSkippedDays).toBe(7);
    expect(r.paymentBreakdown).toEqual({ wallet: 2, razorpay: 1 });
  });
});

describe('aggregateStaffAttendance', () => {
  it('counts present days and sums worked hours per staff', () => {
    const r = aggregateStaffAttendance([
      {
        staff_id: 's1',
        clock_in_time: '2026-05-01T09:00:00Z',
        clock_out_time: '2026-05-01T17:00:00Z',
        profiles: { full_name: 'Asha' },
      },
      {
        staff_id: 's1',
        clock_in_time: '2026-05-02T09:00:00Z',
        clock_out_time: null,
        profiles: { full_name: 'Asha' },
      },
    ]);
    expect(r.totalRecords).toBe(2);
    const asha = r.staffSummary.find((s) => s.staffId === 's1')!;
    expect(asha.name).toBe('Asha');
    expect(asha.daysPresent).toBe(2);
    expect(asha.totalHours).toBeCloseTo(8);
    expect(asha.avgHoursPerDay).toBeCloseTo(4);
  });
});

describe('aggregateOrdersDetail', () => {
  it('groups orders per cycle/day and sums item quantities per menu/day', () => {
    const r = aggregateOrdersDetail([
      {
        dispatch_date: '2026-05-02',
        cycle_id: 1,
        delivery_cycles: { cycle_name: 'Lunch' },
        order_items: [{ item_name: 'Rice', quantity: 2 }],
      },
      {
        dispatch_date: '2026-05-02',
        cycle_id: 1,
        delivery_cycles: { cycle_name: 'Lunch' },
        order_items: [{ item_name: 'Rice', quantity: 3 }],
      },
    ]);
    expect(r.totalOrders).toBe(2);
    expect(r.cycleRows).toEqual([{ date: '2026-05-02', cycleName: 'Lunch', count: 2 }]);
    expect(r.menuRows).toEqual([{ date: '2026-05-02', itemName: 'Rice', qty: 5 }]);
  });

  it('labels subscription-purchase orders (cycle_id null) instead of "Cycle null"', () => {
    const r = aggregateOrdersDetail([
      {
        dispatch_date: '2026-05-02',
        cycle_id: null,
        delivery_cycles: null,
        order_items: [{ item_name: 'Bajji 30', quantity: 1 }],
      },
      {
        dispatch_date: '2026-05-02',
        cycle_id: 1,
        delivery_cycles: { cycle_name: 'Lunch' },
        order_items: [{ item_name: 'Rice', quantity: 1 }],
      },
    ]);
    const labels = r.cycleRows.map((x) => x.cycleName).sort();
    expect(labels).toEqual(['Lunch', 'Subscription Purchase']);
  });
});

describe('aggregateRevenueDetail', () => {
  it('rolls up orders/revenue/tax per day and totals them', () => {
    const r = aggregateRevenueDetail([
      { dispatch_date: '2026-05-01', total_amount: 100, tax_amount: 5 },
      { dispatch_date: '2026-05-01', total_amount: 50, tax_amount: 2 },
      { dispatch_date: '2026-05-02', total_amount: 80, tax_amount: 4 },
    ]);
    // vendorSales joins the shape; the existing figures are untouched, which
    // is the point — the split must not move any number that already existed.
    expect(r.totals).toEqual({ orders: 3, revenue: 230, tax: 11, vendorSales: 0 });
    // sorted descending by date
    expect(r.rows.map((x) => x.date)).toEqual(['2026-05-02', '2026-05-01']);
  });
});

describe('aggregateSubscriptionPlans', () => {
  it('buckets each plan into active/paused/cancelled', () => {
    const r = aggregateSubscriptionPlans([
      { plan_id: 1, is_active: true, is_paused: false, subscription_plans: { plan_name: 'Veg Lunch' } },
      { plan_id: 1, is_active: true, is_paused: true, subscription_plans: { plan_name: 'Veg Lunch' } },
      { plan_id: 1, is_active: false, is_paused: false, subscription_plans: { plan_name: 'Veg Lunch' } },
    ]);
    expect(r).toEqual([{ planName: 'Veg Lunch', active: 1, paused: 1, cancelled: 1 }]);
  });
});

describe('aggregateExpenses', () => {
  it('totals claims and breaks them down by status and category', () => {
    const r = aggregateExpenses([
      { amount: 100, status: 'Approved', category: 'Fuel' },
      { amount: 50, status: 'Pending', category: 'Grocery' },
      { amount: 25, status: 'Rejected', category: 'Fuel' },
    ]);
    expect(r.total).toBe(3);
    expect(r.totalAmount).toBe(175);
    expect(r.approvedAmount).toBe(100);
    expect(r.pendingAmount).toBe(50);
    expect(r.rejectedAmount).toBe(25);
    expect(r.approvedCount).toBe(1);
    expect(r.categoryBreakdown).toEqual({ Fuel: 125, Grocery: 50 });
  });
});

describe('aggregateHubReport', () => {
  it('aggregates per-hub counts, revenue and commission on delivered orders', () => {
    const r = aggregateHubReport([
      { hub_id: 1, total_amount: 100, status: 'Delivered', delivery_hubs: { hub_name: 'Hub A', commission_percent: 10 } },
      { hub_id: 1, total_amount: 200, status: 'Dispatched', delivery_hubs: { hub_name: 'Hub A', commission_percent: 10 } },
      { hub_id: 2, total_amount: 50, status: 'Delivered', delivery_hubs: { hub_name: 'Hub B', commission_percent: null } },
    ]);
    const hubA = r.hubs.find((h) => h.hub_id === 1)!;
    expect(hubA.total_orders).toBe(2);
    expect(hubA.revenue).toBe(300);
    expect(hubA.delivered).toBe(1);
    expect(hubA.dispatched).toBe(1);
    expect(hubA.commission_due).toBeCloseTo(10); // 100 delivered × 10%
    const hubB = r.hubs.find((h) => h.hub_id === 2)!;
    expect(hubB.commission_due).toBe(0); // null commission_percent
    expect(r.totals).toEqual({ total_orders: 3, delivered: 2, revenue: 350, pending: 0 });
  });

  it('skips rows with a null hub_id', () => {
    const r = aggregateHubReport([{ hub_id: null, total_amount: 100, status: 'Delivered' }]);
    expect(r.hubs).toEqual([]);
  });
});

describe('aggregateRevenueDetail — vendor split', () => {
  const orders = [
    { id: 1, dispatch_date: '2026-08-01', total_amount: 300, tax_amount: 15 },
    { id: 2, dispatch_date: '2026-08-01', total_amount: 200, tax_amount: 10 },
  ];

  it('reports gross unchanged when no vendor sold anything', () => {
    // Every existing period is this case — the split must not disturb it.
    const r = aggregateRevenueDetail(orders);
    expect(r.totals.revenue).toBe(500);
    expect(r.vendor.sales).toBe(0);
    expect(r.vendor.ownRevenue).toBe(500);
    expect(r.vendor.netRevenue).toBe(500);
  });

  it('separates money collected for vendor goods from our own', () => {
    // Order 1 carried ₹120 of somebody else's goods. Gross collections are
    // still ₹500 — that IS what customers paid — but only ₹380 of it is ours.
    const r = aggregateRevenueDetail(orders, {
      vendorValueByOrder: { 1: 120 },
      commission: 18,
    });

    expect(r.totals.revenue).toBe(500);
    expect(r.vendor.sales).toBe(120);
    expect(r.vendor.ownRevenue).toBe(380);
    // What the business actually earned: our own takings plus the commission,
    // NOT the ₹500 the old report would have called revenue.
    expect(r.vendor.netRevenue).toBe(398);
  });

  it('carries the vendor share onto the day row', () => {
    const r = aggregateRevenueDetail(orders, {
      vendorValueByOrder: { 1: 120, 2: 50 },
      commission: 25,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].vendorSales).toBe(170);
  });

  it('counts no commission for vendor orders not yet delivered', () => {
    // vendor_earnings is written by the credit-on-delivery trigger, so an
    // undelivered order contributes sales but no commission. Booking it early
    // would overstate income on an order that can still be cancelled.
    const r = aggregateRevenueDetail(orders, {
      vendorValueByOrder: { 1: 120 },
      commission: 0,
    });
    expect(r.vendor.sales).toBe(120);
    expect(r.vendor.commission).toBe(0);
    expect(r.vendor.netRevenue).toBe(380);
  });
});
