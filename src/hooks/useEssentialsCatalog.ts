/**
 * 1stOne F1 — useEssentialsCatalog
 *
 * Admin CRUD for the essentials catalog.
 * Table: essentials_catalog { id, name, cycle_id, price, is_active }
 *
 * Essentials are linked to delivery cycles by cycle_id — the same cycle records
 * used by menu_items. Morning = Breakfast cycle, Noon = Lunch, Evening = Dinner.
 * This ensures essentials are bundled with the correct delivery run.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_STALE_TIME } from '../utils/constants';

/** Friendly display labels for meal cycles when shown in Essentials context */
export const CYCLE_DISPLAY: Record<string, string> = {
  Breakfast: 'Morning',
  Lunch: 'Noon',
  Snacks: 'Afternoon',
  Dinner: 'Evening',
};

export interface EssentialItem {
  id: number;
  name: string;
  cycle_id: number;
  price: number;
  is_active: boolean;
}

export function useAllEssentials(cycleId?: number) {
  return useQuery({
    queryKey: ['admin_essentials', cycleId ?? 'all'],
    queryFn: async () => {
      let query = supabase
        .from('essentials_catalog')
        .select('*')
        .order('name', { ascending: true });
      if (cycleId) query = query.eq('cycle_id', cycleId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as EssentialItem[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

export function useAddEssential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: { name: string; cycle_id: number; price: number }) => {
      const { error } = await supabase
        .from('essentials_catalog')
        .insert({ ...item, is_active: true });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_essentials'] }),
  });
}

export function useUpdateEssentialPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, price }: { id: number; price: number }) => {
      const { error } = await supabase
        .from('essentials_catalog')
        .update({ price })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_essentials'] }),
  });
}

export function useToggleEssential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const { error } = await supabase
        .from('essentials_catalog')
        .update({ is_active })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_essentials'] }),
  });
}
