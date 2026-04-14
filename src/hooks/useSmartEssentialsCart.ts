/**
 * 1stOne F1 — useSmartEssentialsCart
 *
 * Evaluates dispatch scenario (A=today / B=tomorrow) for each
 * item in the essentials cart. Same engine as useSmartCart.
 */

import { useMemo } from 'react';
import { useServerTime } from './useServerTime';
import { useDeliveryCycles } from './useDeliveryCycles';
import { useEssentialsCartStore } from '../store/essentialsCartStore';
import { getDispatchScenario, getDispatchLabel } from '../utils/timeEngine';

export interface EssentialsDispatchEvaluation {
  essential_item_id: number;
  cycle_id: number;
  scenario: 'A' | 'B';
  dispatch_label: string;
  cycle_name: string;
}

export function useSmartEssentialsCart(): {
  evaluations: EssentialsDispatchEvaluation[];
  isLoading: boolean;
} {
  const { data: serverTime, isLoading: timeLoading } = useServerTime();
  const { data: cycles, isLoading: cyclesLoading } = useDeliveryCycles();
  const items = useEssentialsCartStore((s) => s.items);

  const isLoading = timeLoading || cyclesLoading;

  const evaluations = useMemo<EssentialsDispatchEvaluation[]>(() => {
    if (!serverTime || !cycles) return [];

    return items.map((item) => {
      const cycle = cycles.find((c) => c.id === item.cycle_id);
      if (!cycle) {
        return {
          essential_item_id: item.essential_item_id,
          cycle_id: item.cycle_id ?? 0,
          scenario: 'B' as const,
          dispatch_label: 'Tomorrow',
          cycle_name: 'Unknown',
        };
      }

      const scenario = getDispatchScenario(cycle, serverTime);
      return {
        essential_item_id: item.essential_item_id,
        cycle_id: item.cycle_id,
        scenario,
        dispatch_label: getDispatchLabel(scenario),
        cycle_name: cycle.cycle_name,
      };
    });
  }, [items, serverTime, cycles]);

  return { evaluations, isLoading };
}
