/**
 * 1stOne F1 — useMenuManagement
 *
 * Admin CRUD hooks for menu items + delivery cycles, all through the shared
 * Supabase hook layer. Filtered by branch when branch_management_active is on.
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter, requireWriteBranch } from './useBranchFilter';
import type { MenuItem, DeliveryCycle } from '../types';

const MENU_INVALIDATE = [['admin_menu_items'], QUERY_KEYS.MENU_ITEMS] as const;
const CYCLE_INVALIDATE = [['admin_delivery_cycles'], QUERY_KEYS.DELIVERY_CYCLES] as const;

/** Fetch ALL menu items for admin (including inactive) */
export function useAllMenuItems(cycleId?: number) {
  const bf = useBranchFilter();
  return useSupabaseQuery<MenuItem>(
    ['admin_menu_items', cycleId ?? 'all', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let query = supabase
        .from('menu_items')
        .select('*')
        .order('sort_order', { ascending: true });
      if (cycleId) query = query.eq('cycle_id', cycleId);
      if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId);
      return query;
    },
    { staleTime: QUERY_STALE_TIME },
  );
}

/**
 * Add a new menu item.
 *
 * Serves both stages of the builder:
 *   stage 1 — a building-block ITEM: is_customer_visible false, no ingredients
 *   stage 2 — a customer-facing MENU ITEM: is_customer_visible true, with the
 *             "Name:qty;Name:qty" recipe in `ingredients`
 * Omitting the flag keeps the DB default (TRUE), so every existing caller
 * behaves exactly as before.
 *
 * Returns the inserted row's id. A menu photo is stored at a path keyed by
 * that id (`menu-photos/{id}.jpg`), so it cannot be uploaded until the row
 * exists — CreateMenuScreen holds the picked image and attaches it in the
 * onSuccess callback. Callers that ignore the return value are unaffected.
 */
export function useAddMenuItem() {
  const bf = useBranchFilter();
  return useSupabaseMutation<
    {
      cycle_id: number;
      name: string;
      price: number;
      ingredients?: string;
      is_customer_visible?: boolean;
      sort_order?: number;
      description?: string;
    },
    { id: number }
  >(
    (item) =>
      supabase
        .from('menu_items')
        .insert({
          ...item,
          is_active: true,
          sort_order: item.sort_order ?? 0,
          branch_id: requireWriteBranch(bf),
        })
        .select('id')
        .single(),
    MENU_INVALIDATE,
  );
}

/** Update an existing menu item */
export function useUpdateMenuItem() {
  return useSupabaseMutation<Partial<MenuItem> & { id: number }>(
    ({ id, ...updates }) =>
      supabase
        .from('menu_items')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(updates as any)
        .eq('id', id),
    MENU_INVALIDATE,
  );
}

/** Toggle menu item active/inactive */
export function useToggleMenuItem() {
  return useSupabaseMutation<{ id: number; is_active: boolean }>(
    ({ id, is_active }) =>
      supabase.from('menu_items').update({ is_active }).eq('id', id),
    MENU_INVALIDATE,
  );
}

/** Admin: manage delivery cycles */
export function useAllDeliveryCycles() {
  const bf = useBranchFilter();
  return useSupabaseQuery<DeliveryCycle>(
    ['admin_delivery_cycles', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let query = supabase
        .from('delivery_cycles')
        .select('*')
        .order('sort_order', { ascending: true });
      if (bf.isActive && bf.branchId != null) query = query.eq('branch_id', bf.branchId);
      return query;
    },
    { staleTime: QUERY_STALE_TIME },
  );
}

/** Update a delivery cycle */
export function useUpdateDeliveryCycle() {
  return useSupabaseMutation<{ id: number } & Record<string, unknown>>(
    ({ id, ...updates }) =>
      supabase
        .from('delivery_cycles')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(updates as any)
        .eq('id', id),
    CYCLE_INVALIDATE,
  );
}

/** Create a new delivery cycle */
export function useAddDeliveryCycle() {
  const bf = useBranchFilter();
  return useSupabaseMutation<{
    cycle_name: string;
    cutoff_time: string;
    delivery_start: string;
    kitchen_push_time?: string;
    is_essentials?: boolean;
    essentials_label?: string | null;
    sort_order?: number;
  }>(
    (payload) => {
      const row = {
        ...payload,
        kitchen_push_time: payload.kitchen_push_time ?? payload.cutoff_time,
        is_essentials: payload.is_essentials ?? false,
        essentials_label: payload.essentials_label ?? null,
        sort_order: payload.sort_order ?? 99,
        is_active: true,
        branch_id: requireWriteBranch(bf),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return supabase.from('delivery_cycles').insert(row as any);
    },
    CYCLE_INVALIDATE,
  );
}
