/**
 * 1stOne F1 — Admin Notification Manager
 *
 * Blueprint Sec 5 (Phase 2): admin edits push copy for every event and can
 * toggle events on/off without a code push. Each row shows the event_key,
 * editable title, editable body, and an enable switch. Save is per-row.
 *
 * Variables in templates use {{name}} syntax — resolved server-side when the
 * edge function fires the push. Placeholder help text below each body field
 * shows the variables the event provides.
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  Switch,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { ErrorRetry } from '../../components/ErrorRetry';
import {
  useNotificationTemplates,
  useUpdateNotificationTemplate,
  type NotificationTemplate,
} from '../../hooks/useNotificationTemplates';
import type { AdminNavProp } from '../../navigation/types';

// Known variables per event_key — shown as a helper hint below the body field.
const EVENT_VARS: Record<string, string[]> = {
  'order.confirmed':                 ['order_id'],
  'order.razorpay_confirmed':        ['order_id'],
  'order.ready':                     ['order_id'],
  'order.dispatched':                ['order_id'],
  'order.received_at_hub':           ['order_id'],
  'order.delivered':                 ['order_id'],
  'order.cancelled':                 ['order_id'],
  'order.payment_failed':            ['order_id'],
  'wallet.topped_up':                ['amount'],
  'wallet.low_balance':              ['shortfall', 'plan_name'],
  'subscription.activated':          ['plan_name', 'start_date'],
  'subscription.starting_tomorrow':  ['plan_name'],
  'subscription.ending_1d':          ['plan_name'],
  'subscription.ending_2d':          ['plan_name'],
  'winback.dormant':                 [],
};

// Sample values used by the Preview button so admins can see what the push
// will actually look like before saving.
const SAMPLE_VARS: Record<string, string> = {
  order_id: '1234',
  amount: '500',
  shortfall: '50',
  plan_name: '30-Day Lunch',
  start_date: 'Sun, 11 May',
};

function renderSample(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key) => SAMPLE_VARS[key] ?? `{{${key}}}`);
}

function TemplateCard({ template }: { template: NotificationTemplate }) {
  const update = useUpdateNotificationTemplate();
  const [title, setTitle] = useState(template.title_template);
  const [body, setBody] = useState(template.body_template);
  const [enabled, setEnabled] = useState(template.is_enabled);

  const dirty =
    title !== template.title_template ||
    body !== template.body_template ||
    enabled !== template.is_enabled;

  const save = async () => {
    try {
      await update.mutateAsync({
        event_key: template.event_key,
        title_template: title,
        body_template: body,
        is_enabled: enabled,
      });
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message ?? 'Could not update template');
    }
  };

  const toggleEnabled = async (next: boolean) => {
    // Apply the toggle immediately — saves by itself rather than requiring "Save"
    setEnabled(next);
    try {
      await update.mutateAsync({ event_key: template.event_key, is_enabled: next });
    } catch (e: any) {
      setEnabled(!next);
      Alert.alert('Save Failed', e?.message ?? 'Could not update toggle');
    }
  };

  const vars = EVENT_VARS[template.event_key] ?? [];

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1, marginRight: Theme.spacing.sm }}>
          <ThemedText variant="body" color="primary" style={styles.eventKey}>{template.event_key}</ThemedText>
          {template.description ? (
            <ThemedText variant="small" color="muted" style={styles.description}>
              {template.description}
            </ThemedText>
          ) : null}
        </View>
        <Switch
          value={enabled}
          onValueChange={toggleEnabled}
          trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
          thumbColor={Theme.colors.text.primary}
        />
      </View>

      <View style={styles.field}>
        <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Title</ThemedText>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Title shown in push"
          placeholderTextColor={Theme.colors.text.muted}
        />
      </View>

      <View style={styles.field}>
        <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Body</ThemedText>
        <TextInput
          style={[styles.input, styles.bodyInput]}
          value={body}
          onChangeText={setBody}
          placeholder="Body shown in push"
          placeholderTextColor={Theme.colors.text.muted}
          multiline
          textAlignVertical="top"
        />
        {vars.length > 0 && (
          <ThemedText variant="micro" color="muted" style={styles.varsHint}>
            Variables: {vars.map((v) => `{{${v}}}`).join('  ')}
          </ThemedText>
        )}
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={() => Alert.alert(
            renderSample(title) || '(empty title)',
            renderSample(body) || '(empty body)',
          )}
        >
          <ThemedText variant="body" color="accent">Preview  ›</ThemedText>
        </TouchableOpacity>
        {dirty && (
          <TouchableOpacity onPress={save} disabled={update.isPending}>
            {update.isPending
              ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
              : <ThemedText variant="body" color="mint">Save changes  ›</ThemedText>}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export function NotificationManagerScreen({ navigation }: { navigation: AdminNavProp }) {
  const { data: templates, isLoading, error, refetch } = useNotificationTemplates();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="accent">‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Notifications</ThemedText>
        <View style={{ width: 50 }} />
      </View>

      {error ? (
        <ErrorRetry message="Failed to load templates" onRetry={refetch} />
      ) : isLoading ? (
        <ActivityIndicator color={Theme.colors.text.mint} style={styles.loading} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <ThemedText variant="small" color="muted" style={styles.intro}>
            Customize push text per event or toggle any event off. Variables like {'{{order_id}}'} get replaced at send time.
          </ThemedText>
          <Divider />
          {(templates ?? []).map((t) => (
            <TemplateCard key={t.event_key} template={t} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  loading: { marginTop: Theme.spacing.xl },
  intro: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  list: { paddingBottom: Theme.spacing.xl },
  card: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.sm,
  },
  eventKey: {  },
  description: { marginTop: 2 },
  field: { marginTop: Theme.spacing.sm },
  fieldLabel: { letterSpacing: 1, marginBottom: 4 },
  input: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    color: Theme.colors.text.primary,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  bodyInput: { minHeight: 64 },
  varsHint: { marginTop: 4 },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    marginTop: Theme.spacing.sm,
  },
});
