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
import type { DispatchScenario } from '../utils/timeEngine';

export interface CycleDispatch {
  cycle_id: number;
  scenario: DispatchScenario;
  /** YYYY-MM-DD, IST calendar date. */
  dispatch_date: string;
}

export function useCycleDispatch() {
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
    // Dispatch dates roll over at each cycle's cutoff — refresh every minute
    // so a badge flips "Today" → "Tomorrow" without an app restart.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
