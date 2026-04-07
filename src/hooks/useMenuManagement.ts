/**
 * 1stOne F1 — useMenuManagement
 *
 * Admin CRUD hooks for menu items:
 * - Fetch all items (not just active)
 * - Add menu item
 * - Update menu item (price, name, active toggle)
 * - Toggle item active/inactive
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { MenuItem } from '../types';

/** Fetch ALL menu items for admin (including inactive) */
export function useAllMenuItems(cycleId?: number) {
  return useQuery({
    queryKey: ['admin_menu_items', cycleId ?? 'all'],
    queryFn: async () => {
      let query = supabase
        .from('menu_items')
        .select('*')
        .order('sort_order', { ascending: true });

      if (cycleId) {
        query = query.eq('cycle_id', cycleId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as MenuItem[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Add a new menu item */
export function useAddMenuItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: {
      cycle_id: number;
      name: string;
      price: number;
      ingredients?: string;
      sort_order?: number;
    }) => {
      const { error } = await supabase.from('menu_items').insert({
        ...item,
        is_active: true,
        sort_order: item.sort_order ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_menu_items'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MENU_ITEMS });
    },
  });
}

/** Update an existing menu item */
export function useUpdateMenuItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<MenuItem> & { id: number }) => {
      const { error } = await supabase
        .from('menu_items')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_menu_items'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MENU_ITEMS });
    },
  });
}

/** Toggle menu item active/inactive */
export function useToggleMenuItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const { error } = await supabase
        .from('menu_items')
        .update({ is_active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_menu_items'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.MENU_ITEMS });
    },
  });
}

/** Admin: manage delivery cycles */
export function useAllDeliveryCycles() {
  return useQuery({
    queryKey: ['admin_delivery_cycles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_cycles')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Update a delivery cycle */
export function useUpdateDeliveryCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Record<string, unknown>) => {
      const { error } = await supabase
        .from('delivery_cycles')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_delivery_cycles'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.DELIVERY_CYCLES });
    },
  });
}
