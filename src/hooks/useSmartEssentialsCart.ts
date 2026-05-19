/**
 * 1stOne F1 — useSmartEssentialsCart
 *
 * Per-item dispatch evaluation for the essentials cart. Same server-derived
 * dispatch info as useSmartCart (see useCycleDispatch) — the device only maps
 * each cart item to its cycle and applies the display label.
 */

import { useMemo } from 'react';
import { useCycleDispatch } from './useCycleDispatch';
import { useDeliveryCycles } from './useDeliveryCycles';
import { useEssentialsCartStore } from '../store/essentialsCartStore';
import { getDispatchLabel } from '../utils/timeEngine';

export interface EssentialsDispatchEvaluation {
  essential_item_id: number;
  cycle_id: number;
  scenario: 'A' | 'B' | 'C';
  dispatch_label: string;
  cycle_name: string;
}

export function useSmartEssentialsCart(): {
  evaluations: EssentialsDispatchEvaluation[];
  isLoading: boolean;
} {
  const { data: dispatch, isLoading: dispatchLoading } = useCycleDispatch();
  const { data: cycles, isLoading: cyclesLoading } = useDeliveryCycles();
  const items = useEssentialsCartStore((s) => s.items);

  const isLoading = dispatchLoading || cyclesLoading;

  const evaluations = useMemo<EssentialsDispatchEvaluation[]>(() => {
    if (!dispatch || !cycles) return [];

    return items.map((item) => {
      const cycleDispatch = dispatch.get(item.cycle_id);
      const cycle = cycles.find((c) => c.id === item.cycle_id);
      const scenario = cycleDispatch?.scenario ?? 'B';
      return {
        essential_item_id: item.essential_item_id,
        cycle_id: item.cycle_id ?? 0,
        scenario,
        dispatch_label: getDispatchLabel(scenario),
        cycle_name: cycle?.cycle_name ?? 'Unknown',
      };
    });
  }, [items, dispatch, cycles]);

  return { evaluations, isLoading };
}
