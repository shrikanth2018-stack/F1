/**
 * 1stOne F1 — useAdminStats
 *
 * Admin dashboard statistics:
 * - Today's order count + revenue
 * - Active subscriptions count
 * - Pending expense claims
 * - Staff count
 * All from Supabase, zero business logic on device.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_STALE_TIME } from '../utils/constants';

export interface DashboardStats {
  todayOrders: number;
  todayRevenue: number;
  pendingOrders: number;
  deliveredOrders: number;
  activeSubscriptions: number;
  pendingExpenses: number;
  totalStaff: number;
  staffPresentToday: number;
}

export function useAdminStats() {
  const today = new Date().toISOString().split('T')[0];

  return useQuery({
    queryKey: ['admin_stats', today],
    queryFn: async (): Promise<DashboardStats> => {
      const [ordersRes, subsRes, expensesRes, staffRes, presentRes] = await Promise.all([
        supabase
          .from('orders')
          .select('id, status, total_amount')
          .eq('dispatch_date', today),
        supabase
          .from('user_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true),
        supabase
          .from('expense_claims')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'Pending'),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'staff'),
        supabase
          .from('staff_attendance')
          .select('id', { count: 'exact', head: true })
          .eq('date', today)
          .not('clock_in_time', 'is', null),
      ]);

      // Surface any API-level error so React Query sets isError
      const apiError = ordersRes.error || subsRes.error || expensesRes.error
        || staffRes.error || presentRes.error;
      if (apiError) throw new Error(apiError.message);

      const orders = ordersRes.data ?? [];
      const todayRevenue = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
      const pendingOrders = orders.filter((o) => o.status !== 'Delivered' && o.status !== 'Cancelled').length;
      const deliveredOrders = orders.filter((o) => o.status === 'Delivered').length;

      return {
        todayOrders: orders.length,
        todayRevenue,
        pendingOrders,
        deliveredOrders,
        activeSubscriptions: subsRes.count ?? 0,
        pendingExpenses: expensesRes.count ?? 0,
        totalStaff: staffRes.count ?? 0,
        staffPresentToday: presentRes.count ?? 0,
      };
    },
    staleTime: QUERY_STALE_TIME,
    retry: 1,
  });
}
