/**
 * 1stOne F1 — useAdminNotes
 *
 * CRUD for admin_notes table.
 * One note per target_tab ('kitchen' | 'packing' | 'delivery' | 'all').
 * Active notes appear as a banner in the matching staff dashboard tab.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_STALE_TIME } from '../utils/constants';
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
  return useQuery({
    queryKey: ['admin_notes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_notes')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as AdminNote[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Upsert a note for a target_tab. Creates if none exists, updates if one does. */
export function useUpsertNote() {
  const queryClient = useQueryClient();
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
          { target_tab, note_text, is_active },
          { onConflict: 'target_tab' }
        );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin_notes'] }),
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
