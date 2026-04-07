/**
 * 1stOne F1 — useSmartCart
 *
 * Smart Cart Engine: evaluates dispatch scenario per cart item.
 * Uses server time + delivery cycle cutoffs to determine
 * whether each item dispatches today (A) or tomorrow (B).
 */

import { useMemo } from 'react';
import { useServerTime } from './useServerTime';
import { useDeliveryCycles } from './useDeliveryCycles';
import { useCartStore } from '../store/cartStore';
import { getDispatchScenario, getDispatchLabel } from '../utils/timeEngine';
import type { DispatchEvaluation } from '../types';

export function useSmartCart(): {
  evaluations: DispatchEvaluation[];
  isLoading: boolean;
} {
  const { data: serverTime, isLoading: timeLoading } = useServerTime();
  const { data: cycles, isLoading: cyclesLoading } = useDeliveryCycles();
  const items = useCartStore((s) => s.items);

  const isLoading = timeLoading || cyclesLoading;

  const evaluations = useMemo<DispatchEvaluation[]>(() => {
    if (!serverTime || !cycles) return [];

    return items.map((item) => {
      const cycle = cycles.find((c) => c.id === item.cycle_id);
      if (!cycle) {
        return {
          menu_item_id: item.menu_item_id,
          cycle_id: item.cycle_id,
          scenario: 'B' as const,
          dispatch_label: 'Tomorrow',
          cycle_name: 'Unknown',
        };
      }

      const scenario = getDispatchScenario(cycle, serverTime);
      return {
        menu_item_id: item.menu_item_id,
        cycle_id: item.cycle_id,
        scenario,
        dispatch_label: getDispatchLabel(scenario),
        cycle_name: cycle.cycle_name,
      };
    });
  }, [items, serverTime, cycles]);

  return { evaluations, isLoading };
}
