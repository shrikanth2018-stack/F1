/**
 * 1stOne F1 — useHubReport
 *
 * Hub-level delivery analytics for the admin Hub Report screen. Aggregation
 * runs server-side in the `reports` Edge Function (Task 3C) — this hook only
 * calls it. The per-hub stat logic lives in
 * supabase/functions/_shared/reportAggregations.ts.
 */

import { useQuery } from '@tanstack/react-query';
import { invokeFunction } from '../api/invokeFunction';
import { useBranchFilter } from './useBranchFilter';
import type { HubReportResult } from '../../supabase/functions/_shared/reportAggregations';

// Re-exported so existing importers (HubReportScreen) keep working unchanged.
export type { HubStat } from '../../supabase/functions/_shared/reportAggregations';

function fetchHubReport(
  startDate: string,
  endDate: string,
  branchId: number | null,
): Promise<HubReportResult> {
  return invokeFunction<HubReportResult>(
    'reports',
    { report: 'hub', start_date: startDate, end_date: endDate, branch_id: branchId },
    { fallbackMessage: 'Could not load the hub report. Please try again.' },
  );
}

export function useHubReport(startDate: string, endDate: string) {
  const bf = useBranchFilter();
  const branchId = bf.isActive && bf.branchId != null ? bf.branchId : null;

  return useQuery({
    queryKey: ['report_hub', startDate, endDate, bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: () => fetchHubReport(startDate, endDate, branchId),
    staleTime: 5 * 60 * 1000,
  });
}
