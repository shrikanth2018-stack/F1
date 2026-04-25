/**
 * 1stOne F1 — useNotificationTemplates
 *
 * Admin-side reads + writes for the notification_templates table.
 * Each row is identified by event_key (stable, baked into edge functions).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';

export interface NotificationTemplate {
  event_key: string;
  title_template: string;
  body_template: string;
  is_enabled: boolean;
  trigger_source: string | null;
  description: string | null;
  updated_at: string;
}

export function useNotificationTemplates() {
  return useQuery({
    queryKey: ['notification_templates'],
    queryFn: async (): Promise<NotificationTemplate[]> => {
      const { data, error } = await supabase
        .from('notification_templates')
        .select('*')
        .order('event_key');
      if (error) throw new Error(error.message);
      return (data ?? []) as NotificationTemplate[];
    },
    staleTime: 60_000,
  });
}

export function useUpdateNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      event_key: string;
      title_template?: string;
      body_template?: string;
      is_enabled?: boolean;
    }) => {
      const { event_key, ...updates } = payload;
      const { error } = await supabase
        .from('notification_templates')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('event_key', event_key);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification_templates'] }),
  });
}
