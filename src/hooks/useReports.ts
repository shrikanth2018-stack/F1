/**
 * 1stOne F1 — useReports
 *
 * Admin reporting hooks:
 * - Revenue by date range
 * - Order breakdown by status/cycle
 * - Subscription stats
 * - Staff attendance & expense summaries
 * All server-side aggregation via Supabase queries.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useBranchFilter } from './useBranchFilter';

/** Revenue report for a date range */
export function useRevenueReport(startDate: string, endDate: string) {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['report_revenue', startDate, endDate, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('id, total_amount, tax_amount, delivery_fee, dispatch_date, status, cycle_id, payment_method')
        .gte('dispatch_date', startDate)
        .lte('dispatch_date', endDate)
        .neq('status', 'Cancelled')
        .order('dispatch_date', { ascending: true });
      if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId);
      const { data, error } = await query;

      if (error) throw error;
      const orders = data ?? [];

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
        totalTax += o.tax_amount;
        totalDeliveryFees += o.delivery_fee;
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
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Order breakdown by status for a date range */
export function useOrderReport(startDate: string, endDate: string) {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['report_orders', startDate, endDate, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('id, status, cycle_id, order_type, dispatch_date')
        .gte('dispatch_date', startDate)
        .lte('dispatch_date', endDate)
        .order('dispatch_date', { ascending: true });
      if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId);
      const { data, error } = await query;

      if (error) throw error;
      const orders = data ?? [];

      // By status
      const statusBreakdown: Record<string, number> = {};
      for (const o of orders) {
        statusBreakdown[o.status] = (statusBreakdown[o.status] || 0) + 1;
      }

      // By cycle
      const cycleBreakdown: Record<number, number> = {};
      for (const o of orders) {
        cycleBreakdown[o.cycle_id] = (cycleBreakdown[o.cycle_id] || 0) + 1;
      }

      // By type
      const typeBreakdown: Record<string, number> = {};
      for (const o of orders) {
        typeBreakdown[o.order_type] = (typeBreakdown[o.order_type] || 0) + 1;
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
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Subscription stats */
export function useSubscriptionReport() {
  return useQuery({
    queryKey: ['report_subscriptions'],
    queryFn: async () => {
      const [activeRes, allRes, cancelledDaysRes] = await Promise.all([
        supabase
          .from('user_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .eq('is_paused', false),
        supabase
          .from('user_subscriptions')
          .select('id, is_active, is_paused, plan_id, payment_method, created_at'),
        supabase
          .from('cancelled_subscription_days')
          .select('id', { count: 'exact', head: true }),
      ]);

      const all = allRes.data ?? [];
      const active = activeRes.count ?? 0;
      const paused = all.filter((s) => s.is_paused).length;
      const cancelled = all.filter((s) => !s.is_active && !s.is_paused).length;
      const totalSkippedDays = cancelledDaysRes.count ?? 0;

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
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Staff attendance summary for a date range */
export function useStaffAttendanceReport(startDate: string, endDate: string) {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['report_staff_attendance', startDate, endDate, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('staff_attendance')
        .select('*, profiles!staff_attendance_staff_id_fkey(full_name, phone_number)')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });
      if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId);
      const { data, error } = await query;

      if (error) throw error;
      const records = data ?? [];

      // Per-staff summary
      const staffMap: Record<string, {
        name: string;
        daysPresent: number;
        totalHours: number;
      }> = {};

      for (const r of records) {
        const id = r.staff_id;
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
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Orders detail: cycle-wise and menu-wise day-level rows */
export function useOrdersDetailReport(startDate: string, endDate: string) {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['report_orders_detail', startDate, endDate, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('id, dispatch_date, cycle_id, delivery_cycles(cycle_name), order_items(item_name, quantity)')
        .gte('dispatch_date', startDate)
        .lte('dispatch_date', endDate)
        .neq('status', 'Cancelled')
        .order('dispatch_date', { ascending: false });
      if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId);
      const { data, error } = await query;

      if (error) throw error;
      const orders = (data ?? []) as any[];

      const cycleMap: Record<string, { date: string; cycleName: string; count: number }> = {};
      const menuMap: Record<string, { date: string; itemName: string; qty: number }> = {};

      for (const o of orders) {
        const cycleName = o.delivery_cycles?.cycle_name ?? `Cycle ${o.cycle_id}`;
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
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Revenue detail: day-level rows with orders, revenue, tax */
export function useRevenueDetailReport(startDate: string, endDate: string) {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['report_revenue_detail', startDate, endDate, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('id, dispatch_date, total_amount, tax_amount')
        .gte('dispatch_date', startDate)
        .lte('dispatch_date', endDate)
        .neq('status', 'Cancelled')
        .order('dispatch_date', { ascending: false });
      if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId);
      const { data, error } = await query;

      if (error) throw error;
      const orders = (data ?? []) as any[];

      const dayMap: Record<string, { date: string; orders: number; revenue: number; tax: number }> = {};
      for (const o of orders) {
        if (!dayMap[o.dispatch_date])
          dayMap[o.dispatch_date] = { date: o.dispatch_date, orders: 0, revenue: 0, tax: 0 };
        dayMap[o.dispatch_date].orders++;
        dayMap[o.dispatch_date].revenue += o.total_amount ?? 0;
        dayMap[o.dispatch_date].tax += o.tax_amount ?? 0;
      }

      const rows = Object.values(dayMap).sort((a, b) => b.date.localeCompare(a.date));
      const totals = rows.reduce(
        (acc, r) => ({ orders: acc.orders + r.orders, revenue: acc.revenue + r.revenue, tax: acc.tax + r.tax }),
        { orders: 0, revenue: 0, tax: 0 }
      );

      return { rows, totals };
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Subscription plan-wise breakdown */
export function useSubscriptionPlanReport() {
  return useQuery({
    queryKey: ['report_subscription_plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('id, is_active, is_paused, plan_id, subscription_plans(plan_name)');

      if (error) throw error;
      const all = (data ?? []) as any[];

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
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Expense claims summary for a date range */
export function useExpenseReport(startDate: string, endDate: string) {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['report_expenses', startDate, endDate, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('expense_claims')
        .select('*')
        .gte('created_at', `${startDate}T00:00:00`)
        .lte('created_at', `${endDate}T23:59:59`)
        .order('created_at', { ascending: false });
      if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId);
      const { data, error } = await query;

      if (error) throw error;
      const claims = data ?? [];

      const totalAmount = claims.reduce((s, c) => s + c.amount, 0);
      const approved = claims.filter((c) => c.status === 'Approved');
      const pending = claims.filter((c) => c.status === 'Pending');
      const rejected = claims.filter((c) => c.status === 'Rejected');

      // By category
      const categoryBreakdown: Record<string, number> = {};
      for (const c of claims) {
        categoryBreakdown[c.category] = (categoryBreakdown[c.category] || 0) + c.amount;
      }

      return {
        total: claims.length,
        totalAmount,
        approvedAmount: approved.reduce((s, c) => s + c.amount, 0),
        pendingAmount: pending.reduce((s, c) => s + c.amount, 0),
        rejectedAmount: rejected.reduce((s, c) => s + c.amount, 0),
        approvedCount: approved.length,
        pendingCount: pending.length,
        rejectedCount: rejected.length,
        categoryBreakdown,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
