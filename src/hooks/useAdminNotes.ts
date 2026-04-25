/**
 * 1stOne F1 — useAdminNotes
 *
 * CRUD for admin_notes table.
 * One note per target_tab ('kitchen' | 'packing' | 'delivery' | 'all').
 * Active notes appear as a banner in the matching staff dashboard tab.
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { AdminNote } from '../types';

export type NoteTarget = 'kitchen' | 'packing' | 'delivery' | 'all' | 'hub';

export const NOTE_TARGETS: { key: NoteTarget; label: string }[] = [
  { key: 'all',      label: 'All Staff'  },
  { key: 'kitchen',  label: 'Kitchen'    },
  { key: 'packing',  label: 'Packing'    },
  { key: 'delivery', label: 'Delivery'   },
  { key: 'hub',      label: 'Hub Staff'  },
];

export function useAdminNotes() {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['admin_notes', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('admin_notes')
        .select('*')
        .order('created_at', { ascending: true });

      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as AdminNote[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Upsert a note for a target_tab. Creates if none exists, updates if one does. */
export function useUpsertNote() {
  const queryClient = useQueryClient();
  const bf = useBranchFilter();
  return useMutation({
    mutationFn: async ({
      target_tab,
      note_text,
      is_active,
    }: {
      target_tab: NoteTarget;
      note_text: string;
      is_active: boolean;
    }) => {
      const { error } = await supabase
        .from('admin_notes')
        .upsert(
          {
            target_tab,
            note_text,
            is_active,
            branch_id: bf.isActive ? bf.branchId : null,
          },
          // Matches the composite UNIQUE (target_tab, branch_id) constraint.
          // NULLS NOT DISTINCT keeps single-branch / super-admin setups happy
          // — NULL branch_id collides with other NULL branch_ids.
          { onConflict: 'target_tab,branch_id' }
        );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_notes'] }),
  });
}

/**
 * Staff-side read — returns active notes for the given tab.
 * Includes 'all' (broadcasts) plus the tab-specific one if any.
 * Branch-filtered through useBranchFilter.
 *
 * Short stale time so toggling a note on/off in admin reflects within ~5s.
 */
export function useStaffNoteForTab(tab: NoteTarget | null) {
  const bf = useBranchFilter();
  return useQuery({
    queryKey: ['staff_notes', tab ?? 'none', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      if (!tab) return [] as AdminNote[];
      let q = supabase
        .from('admin_notes')
        .select('*')
        .eq('is_active', true)
        .in('target_tab', tab === 'all' ? ['all'] : ['all', tab])
        .order('created_at', { ascending: false });
      if (bf.isActive && bf.branchId != null) q = q.eq('branch_id', bf.branchId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as AdminNote[];
    },
    enabled: tab != null,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}

/** Toggle a note on/off by id. */
export function useToggleNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const { error } = await supabase
        .from('admin_notes')
        .update({ is_active })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_notes'] }),
  });
}
