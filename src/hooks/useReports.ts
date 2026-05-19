/**
 * 1stOne F1 — useReports
 *
 * Admin reporting hooks. All aggregation runs server-side in the `reports`
 * Edge Function (Task 3C) — these hooks only call it. The aggregation logic
 * lives in supabase/functions/_shared/reportAggregations.ts (a verbatim lift
 * of what used to run on-device, so report numbers are unchanged).
 */

import { useQuery } from '@tanstack/react-query';
import { invokeFunction } from '../api/invokeFunction';
import { useBranchFilter } from './useBranchFilter';
import type {
  SubscriptionReport,
  StaffAttendanceReport,
  OrdersDetailReport,
  RevenueDetailReport,
  SubscriptionPlanReport,
} from '../../supabase/functions/_shared/reportAggregations';

const REPORT_STALE_TIME = 5 * 60 * 1000;

/** Calls the `reports` Edge Function for one report and returns its result. */
function fetchReport<T>(
  report: string,
  params: { startDate?: string; endDate?: string; branchId: number | null },
): Promise<T> {
  return invokeFunction<T>(
    'reports',
    {
      report,
      start_date: params.startDate,
      end_date: params.endDate,
      branch_id: params.branchId,
    },
    { fallbackMessage: 'Could not load the report. Please try again.' },
  );
}

/** Resolved branch filter value — mirrors the previous on-device gate. */
function useBranchId(): { branchId: number | null; keyPart: string | number } {
  const bf = useBranchFilter();
  return {
    branchId: bf.isActive && bf.branchId != null ? bf.branchId : null,
    keyPart: bf.isActive ? bf.branchId ?? 'all' : 'off',
  };
}


/** Subscription stats */
export function useSubscriptionReport() {
  const { branchId, keyPart } = useBranchId();
  return useQuery({
    queryKey: ['report_subscriptions', keyPart],
    queryFn: () => fetchReport<SubscriptionReport>('subscription', { branchId }),
    staleTime: REPORT_STALE_TIME,
  });
}

/** Staff attendance summary for a date range */
export function useStaffAttendanceReport(startDate: string, endDate: string) {
  const { branchId, keyPart } = useBranchId();
  return useQuery({
    queryKey: ['report_staff_attendance', startDate, endDate, keyPart],
    queryFn: () => fetchReport<StaffAttendanceReport>('staffAttendance', { startDate, endDate, branchId }),
    staleTime: REPORT_STALE_TIME,
  });
}

/** Orders detail: cycle-wise and menu-wise day-level rows */
export function useOrdersDetailReport(startDate: string, endDate: string) {
  const { branchId, keyPart } = useBranchId();
  return useQuery({
    queryKey: ['report_orders_detail', startDate, endDate, keyPart],
    queryFn: () => fetchReport<OrdersDetailReport>('ordersDetail', { startDate, endDate, branchId }),
    staleTime: REPORT_STALE_TIME,
  });
}

/** Revenue detail: day-level rows with orders, revenue, tax */
export function useRevenueDetailReport(startDate: string, endDate: string) {
  const { branchId, keyPart } = useBranchId();
  return useQuery({
    queryKey: ['report_revenue_detail', startDate, endDate, keyPart],
    queryFn: () => fetchReport<RevenueDetailReport>('revenueDetail', { startDate, endDate, branchId }),
    staleTime: REPORT_STALE_TIME,
  });
}

/** Subscription plan-wise breakdown */
export function useSubscriptionPlanReport() {
  const { branchId, keyPart } = useBranchId();
  return useQuery({
    queryKey: ['report_subscription_plans', keyPart],
    queryFn: () => fetchReport<SubscriptionPlanReport>('subscriptionPlan', { branchId }),
    staleTime: REPORT_STALE_TIME,
  });
}
