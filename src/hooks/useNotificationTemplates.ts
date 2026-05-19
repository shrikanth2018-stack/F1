/**
 * 1stOne F1 — useNotificationTemplates
 *
 * Admin-side reads + writes for the notification_templates table.
 * Each row is identified by event_key (stable, baked into edge functions).
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery, useSupabaseMutation } from '../api/useSupabaseQuery';

export interface NotificationTemplate {
  event_key: string;
  title_template: string;
  body_template: string;
  is_enabled: boolean;
  trigger_source: string | null;
  description: string | null;
  /** {{variable}} names this event provides — drives the admin var-hints (D21). */
  variables: string[];
  updated_at: string;
}

export function useNotificationTemplates() {
  return useSupabaseQuery<NotificationTemplate>(
    ['notification_templates'],
    () => supabase.from('notification_templates').select('*').order('event_key'),
    { staleTime: 60_000 },
  );
}

export function useUpdateNotificationTemplate() {
  return useSupabaseMutation<{
    event_key: string;
    title_template?: string;
    body_template?: string;
    is_enabled?: boolean;
  }>(
    ({ event_key, ...updates }) =>
      supabase
        .from('notification_templates')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('event_key', event_key),
    [['notification_templates']],
  );
}
