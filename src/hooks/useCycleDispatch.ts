/**
 * 1stOne F1 — useCycleDispatch
 *
 * Server-authoritative dispatch info per delivery cycle. Calls the
 * `cycle-dispatch` Edge Function, which derives each active cycle's scenario
 * (A/B/C) and dispatch date from the server clock via the shared dispatch
 * rule. The device computes nothing about scheduling.
 *
 * Returns a Map keyed by cycle_id for O(1) lookup.
 */

import { useQuery } from '@tanstack/react-query';
import { invokeFunction } from '../api/invokeFunction';
import { useDeliveryCycles } from './useDeliveryCycles';
import type { DispatchScenario } from '../utils/timeEngine';

export interface CycleDispatch {
  cycle_id: number;
  scenario: DispatchScenario;
  /** YYYY-MM-DD, IST calendar date. */
  dispatch_date: string;
}

/** IST minutes-since-midnight for `now`, via the explicit zone (no client-TZ math). */
function istNowMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

/** "HH:MM[:SS]" → minutes since midnight. */
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Ms until the next cutoff boundary — the ONLY moment a badge can flip.
 * Falls back to the cap when no cycle data is cached yet.
 */
function msUntilNextCutoff(cutoffs: number[], now: Date): number {
  if (cutoffs.length === 0) return MAX_POLL_MS;
  const nowMin = istNowMinutes(now);
  let best = Infinity;
  for (const c of cutoffs) {
    // Minutes until this cutoff, wrapping past midnight.
    const delta = c > nowMin ? c - nowMin : c + 1440 - nowMin;
    if (delta < best) best = delta;
  }
  return best * 60_000 + 5_000; // +5s margin so the server has surely ticked over
}

const MIN_POLL_MS = 30_000;
const MAX_POLL_MS = 15 * 60_000;

export function useCycleDispatch() {
  // Cutoff times are already cached app-wide by useDeliveryCycles — reading
  // them here adds no network cost.
  const { data: cycles } = useDeliveryCycles();
  const cutoffs = (cycles ?? [])
    .map((c: { cutoff_time: string | null }) => c.cutoff_time)
    .filter((t): t is string => !!t)
    .map(toMinutes);

  return useQuery({
    queryKey: ['cycle_dispatch'],
    queryFn: async (): Promise<Map<number, CycleDispatch>> => {
      const data = await invokeFunction<{ cycles: CycleDispatch[] }>(
        'cycle-dispatch',
        undefined,
        { fallbackMessage: 'Could not load the dispatch schedule.' },
      );
      const list = data?.cycles ?? [];
      return new Map(list.map((c) => [c.cycle_id, c]));
    },
    // Health report #13: this used to poll the edge function every 60s per
    // active session, forever. A badge can only flip at a cycle CUTOFF —
    // so schedule the next refetch for that boundary (clamped 30s..15min).
    // The DATA stays server-derived; only the refresh *schedule* uses the
    // device clock, so a skewed clock can at worst delay a badge flip by
    // one poll cap, never produce a wrong date.
    staleTime: 30_000,
    refetchInterval: () =>
      Math.min(Math.max(msUntilNextCutoff(cutoffs, new Date()), MIN_POLL_MS), MAX_POLL_MS),
  });
}
