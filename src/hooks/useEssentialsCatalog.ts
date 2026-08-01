/**
 * 1stOne F1 — useEssentialsCatalog
 *
 * Admin CRUD for the essentials catalog.
 * Table: essentials_catalog { id, name, cycle_id, price, is_active, branch_id }
 *
 * Essentials are linked to delivery cycles by cycle_id — the same cycle records
 * used by menu_items. Morning = Breakfast cycle, Noon = Lunch, Evening = Dinner.
 * This ensures essentials are bundled with the correct delivery run.
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter, requireWriteBranch } from './useBranchFilter';

/** Friendly display labels for meal cycles when shown in Essentials context */
export const CYCLE_DISPLAY: Record<string, string> = {
  Breakfast: 'Morning',
  Lunch: 'Midday',
  Snacks: 'Afternoon',
  Dinner: 'Evening',
};

export interface EssentialItem {
  id: number;
  name: string;
  cycle_id: number;
  price: number;
  is_active: boolean;
  branch_id: number | null;
  /** NULL = 1stOne's own item. Set = sold by a third-party vendor. */
  vendor_id?: number | null;
  /** Storage path of the item's one photo — `essentials-photos/{id}.jpg`. */
  image_path?: string | null;
  /** Stamped on every photo upload; used to bust the CDN cache. */
  image_updated_at?: string | null;
  description?: string | null;
}

export function useAllEssentials(cycleId?: number) {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['admin_essentials', cycleId ?? 'all', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('essentials_catalog')
        .select('*')
        .order('name', { ascending: true });
      if (cycleId) query = query.eq('cycle_id', cycleId);
      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as EssentialItem[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/**
 * Add an essentials item.
 *
 * Returns the inserted row's id. A photo is stored at a path keyed by that id
 * (`essentials-photos/{id}.jpg`), so it cannot be uploaded until the row
 * exists — CreateEssentialScreen holds the picked image and attaches it in
 * the onSuccess callback.
 */
export function useAddEssential() {
  const queryClient = useQueryClient();
  const bf = useBranchFilter();
  return useMutation({
    mutationFn: async (item: {
      name: string;
      cycle_id: number;
      price: number;
      description?: string;
    }) => {
      const { data, error } = await supabase
        .from('essentials_catalog')
        .insert({
          ...item,
          is_active: true,
          branch_id: requireWriteBranch(bf),
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_essentials'] });
      // The customer-facing list is a different key — without this a newly
      // added item stays invisible on Home for up to the stale window.
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ESSENTIALS });
    },
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
