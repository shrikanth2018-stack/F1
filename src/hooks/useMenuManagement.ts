/**
 * 1stOne F1 — useMenuManagement
 *
 * Admin CRUD hooks for menu items + delivery cycles, all through the shared
 * Supabase hook layer. Filtered by branch when branch_management_active is on.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter, requireWriteBranch } from './useBranchFilter';
import type { MenuItem, DeliveryCycle } from '../types';

const MENU_INVALIDATE = [['admin_menu_items'], QUERY_KEYS.MENU_ITEMS] as const;
const CYCLE_INVALIDATE = [['admin_delivery_cycles'], QUERY_KEYS.DELIVERY_CYCLES] as const;

/**
 * Step 1 — building blocks. No cycle: an ingredient is not a mealtime, and
 * since the rebuild they carry cycle_id NULL, so this is a single flat list
 * rather than one per cycle.
 */
export function useMenuBlocks() {
  const bf = useBranchFilter();
  return useSupabaseQuery<MenuItem>(
    ['menu_blocks', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let q = supabase
        .from('menu_items')
        .select('*')
        .eq('is_customer_visible', false)
        .order('sort_order', { ascending: true });
      if (bf.isActive && bf.branchId != null) q = q.eq('branch_id', bf.branchId);
      return q;
    },
    { staleTime: QUERY_STALE_TIME },
  );
}

/** Step 2 — the customer-facing dishes of one cycle. */
export function useMenusForCycle(cycleId?: number) {
  const bf = useBranchFilter();
  return useSupabaseQuery<MenuItem>(
    ['menus_for_cycle', cycleId ?? 'all', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let q = supabase
        .from('menu_items')
        .select('*')
        .eq('is_customer_visible', true)
        .order('sort_order', { ascending: true });
      if (cycleId) q = q.eq('cycle_id', cycleId);
      if (bf.isActive && bf.branchId != null) q = q.eq('branch_id', bf.branchId);
      return q;
    },
    { staleTime: QUERY_STALE_TIME },
  );
}

const BLOCK_INVALIDATE = [['menu_blocks'], ['menus_for_cycle'], ['admin_menu_items']] as const;
const MENU_INVALIDATE_ALL = [
  ['menus_for_cycle'], ['menu_blocks'], ['admin_menu_items'], QUERY_KEYS.MENU_ITEMS,
] as const;

/** Create a block. An RPC, so the server sets cycle_id NULL and visibility. */
export function useCreateMenuBlock() {
  const bf = useBranchFilter();
  return useSupabaseMutation<{ name: string; price: number; unit: string }, number>(
    (p) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc('admin_create_menu_block', {
        p_name: p.name,
        p_price: p.price,
        p_branch_id: requireWriteBranch(bf),
        p_unit: p.unit,
      }),
    BLOCK_INVALIDATE as unknown as string[][],
  );
}

/**
 * Change how a block is measured — AND rewrite every recipe naming it.
 *
 * Same shape as a rename, for the same reason: the unit lives in the recipe
 * text as well as on the row, and the kitchen board reads the text. Leaving
 * the two out of step splits one ingredient into two prep lines, because
 * `get_kitchen_aggregate` groups by (name, unit). Returns how many menus it
 * rewrote.
 */
export function useSetMenuBlockUnit() {
  return useSupabaseMutation<{ id: number; unit: string }, number>(
    (p) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc('admin_set_menu_block_unit', { p_id: p.id, p_unit: p.unit }),
    BLOCK_INVALIDATE as unknown as string[][],
  );
}

/**
 * Rename a block AND every recipe naming it.
 *
 * Server-side because it cannot half-apply, and because a plain string
 * replace would be wrong: eight block names contain another block's name, so
 * renaming "Rice" would corrupt Curd Rice, Fried Rice, Rice Pullav and two
 * more. The RPC compares each recipe's name part exactly.
 */
export function useRenameMenuBlock() {
  return useSupabaseMutation<{ oldName: string; newName: string }, number>(
    (p) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc('admin_rename_menu_block', {
        p_old: p.oldName,
        p_new: p.newName,
      }),
    MENU_INVALIDATE_ALL as unknown as string[][],
  );
}

/**
 * How many menus name this block — shown before disabling or removing it.
 *
 * Plain useQuery rather than the shared helper: this RPC returns a scalar,
 * and useSupabaseQuery is shaped for row sets.
 */
export function useBlockUsage(name?: string) {
  return useQuery({
    queryKey: ['menu_block_usage', name ?? 'none'],
    queryFn: async (): Promise<number> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('menu_block_usage', { p_name: name });
      if (error) throw new Error(error.message);
      return (data as number) ?? 0;
    },
    enabled: !!name,
    staleTime: QUERY_STALE_TIME,
  });
}

/**
 * Remove an item. Returns 'deleted' or 'retired' — the server decides, based
 * on whether it was ever ordered, so the UI never has to guess and can say
 * which happened.
 */
export function useRemoveMenuItem() {
  return useSupabaseMutation<{ id: number }, string>(
    (p) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc('admin_remove_menu_item', { p_id: p.id }),
    MENU_INVALIDATE_ALL as unknown as string[][],
  );
}

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
 * exists — MenuEditorModal holds the picked image and attaches it once the
 * insert returns. Callers that ignore the return value are unaffected.
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
