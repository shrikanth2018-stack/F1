/**
 * 1stOne F1 — useAdminNotes
 *
 * CRUD for admin_notes table.
 * One note per target_tab ('kitchen' | 'packing' | 'delivery' | 'all').
 * Active notes appear as a banner in the matching staff dashboard tab.
 * Filtered by branch when branch_management_active is on.
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter, requireWriteBranch } from './useBranchFilter';
import type { AdminNote } from '../types';

export type NoteTarget = 'kitchen' | 'packing' | 'delivery' | 'all' | 'hub';

export const NOTE_TARGETS: { key: NoteTarget; label: string }[] = [
  { key: 'all',      label: 'All Staff'    },
  { key: 'kitchen',  label: 'Kitchen'      },
  { key: 'packing',  label: 'Packing'      },
  { key: 'delivery', label: 'Delivery page'},
  { key: 'hub',      label: 'Hub page'     },
];

export function useAdminNotes() {
  const bf = useBranchFilter();

  return useSupabaseQuery<AdminNote>(
    ['admin_notes', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      let query = supabase
        .from('admin_notes')
        .select('*')
        .order('created_at', { ascending: true });
      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }
      return query;
    },
    { staleTime: QUERY_STALE_TIME },
  );
}

/** Upsert a note for a target_tab. Creates if none exists, updates if one does. */
export function useUpsertNote() {
  const bf = useBranchFilter();
  return useSupabaseMutation<{ target_tab: NoteTarget; note_text: string; is_active: boolean }>(
    ({ target_tab, note_text, is_active }) =>
      supabase.from('admin_notes').upsert(
        {
          target_tab,
          note_text,
          is_active,
          branch_id: requireWriteBranch(bf),
        },
        // Matches the composite UNIQUE (target_tab, branch_id) constraint.
        // NULLS NOT DISTINCT keeps single-branch / super-admin setups happy
        // — NULL branch_id collides with other NULL branch_ids.
        { onConflict: 'target_tab,branch_id' },
      ),
    [['admin_notes']],
  );
}

/**
 * Staff-side read — returns active notes for the given tab.
 *
 * Kitchen / Packing / Delivery see the 'all' broadcast plus their own
 * tab-specific note. The Hub is deliberately excluded from 'all':
 * "All Staff" is a kitchen-floor / driver message, so the Hub dashboard
 * shows ONLY 'hub'-targeted notes — never the All-Staff broadcast.
 * Branch-filtered through useBranchFilter.
 *
 * Short stale time so toggling a note on/off in admin reflects within ~5s.
 */
export function useStaffNoteForTab(tab: NoteTarget | null) {
  const bf = useBranchFilter();
  return useSupabaseQuery<AdminNote>(
    ['staff_notes', tab ?? 'none', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    () => {
      // `enabled` below gates this to a non-null tab.
      // Hub is scoped to 'hub' only; the 'all' broadcast skips it.
      const targets =
        tab === 'hub' ? ['hub']
        : tab === 'all' ? ['all']
        : ['all', tab as string];
      let q = supabase
        .from('admin_notes')
        .select('*')
        .eq('is_active', true)
        .in('target_tab', targets)
        .order('created_at', { ascending: false });
      if (bf.isActive && bf.branchId != null) q = q.eq('branch_id', bf.branchId);
      return q;
    },
    { enabled: tab != null, staleTime: 5_000, refetchOnWindowFocus: true },
  );
}
