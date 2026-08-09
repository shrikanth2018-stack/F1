/**
 * 1stOne F1 — useSmartCart
 *
 * Per-item dispatch evaluation for THE cart — food and essentials alike.
 * There was a second, identical hook for the essentials cart; one cart needs
 * one of these. The dispatch scenario is
 * server-derived (see useCycleDispatch / the cycle-dispatch Edge Function) —
 * the device only maps each cart item to its cycle's dispatch info and
 * applies the display label.
 */

import { useMemo } from 'react';
import { useCycleDispatch } from './useCycleDispatch';
import { useDeliveryCycles } from './useDeliveryCycles';
import { useCartStore } from '../store/cartStore';
import { getDispatchLabel } from '../utils/timeEngine';
import type { DispatchEvaluation } from '../types';

export function useSmartCart(): {
  evaluations: DispatchEvaluation[];
  isLoading: boolean;
} {
  const { data: dispatch, isLoading: dispatchLoading } = useCycleDispatch();
  const { data: cycles, isLoading: cyclesLoading } = useDeliveryCycles();
  const items = useCartStore((s) => s.items);

  const isLoading = dispatchLoading || cyclesLoading;

  const evaluations = useMemo<DispatchEvaluation[]>(() => {
    if (!dispatch || !cycles) return [];

    return items.map((item) => {
      const cycleDispatch = dispatch.get(item.cycle_id);
      const cycle = cycles.find((c) => c.id === item.cycle_id);
      // Unknown cycle → conservative 'B' (tomorrow) so the badge never
      // over-promises a same-day delivery.
      const scenario = cycleDispatch?.scenario ?? 'B';
      return {
        item_id: item.item_id,
        item_type: item.item_type,
        cycle_id: item.cycle_id,
        scenario,
        dispatch_label: getDispatchLabel(scenario),
        cycle_name: cycle?.cycle_name ?? 'Unknown',
      };
    });
  }, [items, dispatch, cycles]);

  return { evaluations, isLoading };
}
