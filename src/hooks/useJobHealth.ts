/**
 * 1stOne F1 — useJobHealth
 *
 * Admin observability (audit O1). Reads the get_job_health() RPC — one
 * admin-gated SECURITY DEFINER call returning every pg_cron job's last
 * run + 24h failure count, the recent dispatch manifest runs, and the
 * push-delivery outcomes over the last 24h.
 *
 * D3 already alerts admins on a cron failure; this is the surface they
 * land on to see the whole background-job picture at a glance.
 */

import { useSupabaseSingle } from '../api/useSupabaseQuery';
import { supabase } from '../api/supabaseClient';

export interface CronJobHealth {
  jobname: string;
  schedule: string;
  active: boolean;
  /** Last run start time (ISO), or null if the job has never run. */
  last_run: string | null;
  /** 'succeeded' | 'failed' | 'running' | null. */
  last_status: string | null;
  last_message: string | null;
  failures_24h: number;
}

export interface ManifestRun {
  run_date: string;
  ran_at: string;
  orders_created: number;
  orders_skipped: number;
  subs_skipped: number;
  error_detail: string | null;
}

export interface JobHealth {
  jobs: CronJobHealth[];
  manifest: ManifestRun[];
  /** push_logs status → count over the last 24h, e.g. { sent: 12, failed: 1 }. */
  push_24h: Record<string, number>;
  checked_at: string;
}

/** Background-job health snapshot. Admin-only (the RPC enforces it). */
export function useJobHealth() {
  return useSupabaseSingle<JobHealth>(
    ['job_health'],
    // get_job_health post-dates the generated Supabase types — cast the
    // RPC name (MF-08 pattern).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => supabase.rpc('get_job_health' as any),
    { staleTime: 30_000 },
  );
}
