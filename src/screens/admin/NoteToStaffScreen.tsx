/**
 * 1stOne F1 — Note to Staff Screen
 *
 * Admin composes a note per staff group (All Staff / Kitchen / Packing /
 * Delivery / Hub). Each group has an enable/disable toggle and a text
 * input. Save upserts all groups; active notes appear as an in-app
 * banner on the matching staff/driver/hub dashboard via the
 * admin_notes realtime subscription (useRealtimeOrders). No system
 * push notification is sent — banners only, by design, so drivers /
 * staff aren't pinged on the phone tray for non-actionable info.
 */

import React, { useState, useEffect } from 'react';
import { infoDialog } from '../../utils/confirmDialog';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { getErrorMessage } from '../../utils/formatters';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ScreenHeader } from '../../components/ScreenHeader';
import {
  useAdminNotes,
  useUpsertNote,
  NOTE_TARGETS,
  type NoteTarget,
} from '../../hooks/useAdminNotes';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type NoteState = { text: string; active: boolean };

export function NoteToStaffScreen() {
  const { data: notes = [], isLoading } = useAdminNotes();
  const upsert = useUpsertNote();

  // Local state keyed by target
  const [state, setState] = useState<Record<NoteTarget, NoteState>>({
    all:      { text: '', active: false },
    kitchen:  { text: '', active: false },
    packing:  { text: '', active: false },
    delivery: { text: '', active: false },
    hub:      { text: '', active: false },
  });

  // Seed from DB once loaded
  useEffect(() => {
    if (!notes.length) return;
    setState((prev) => {
      const next = { ...prev };
      for (const n of notes) {
        const k = n.target_tab as NoteTarget;
        next[k] = { text: n.note_text ?? '', active: n.is_active };
      }
      return next;
    });
  }, [notes]);

  const setField = (key: NoteTarget, field: keyof NoteState, value: string | boolean) => {
    setState((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const handlePush = async () => {
    const targets = NOTE_TARGETS.filter((t) => state[t.key].text.trim());
    if (!targets.length) {
      infoDialog('Nothing to save', 'Enter a message for at least one group.');
      return;
    }

    try {
      // Save the note rows; the admin_notes realtime subscription in
      // useRealtimeOrders flips the matching dashboard's banner the
      // instant the row hits the DB. No system push — banners only.
      await Promise.all(
        targets.map((t) =>
          upsert.mutateAsync({
            target_tab: t.key,
            note_text: state[t.key].text.trim(),
            is_active: state[t.key].active,
          })
        )
      );

      infoDialog('Saved', 'Notes updated. Staff will see the banner now.');
    } catch (e) {
      infoDialog('Error', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <ScreenHeader title="Note to Staff" />

      <ScrollView keyboardDismissMode="on-drag"
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ThemedText variant="small" color="muted" style={styles.hint}>
          Active notes show as a banner on the matching dashboard.
        </ThemedText>

        {NOTE_TARGETS.map((target) => (
          <View key={target.key} style={styles.card}>
            {/* Group header row */}
            <View style={styles.cardHeader}>
              <ThemedText variant="body" color="primary" style={styles.groupLabel}>
                {target.label}
              </ThemedText>
              <Switch
                value={state[target.key].active}
                onValueChange={(v) => setField(target.key, 'active', v)}
                trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
                thumbColor={Theme.colors.text.primary}
              />
            </View>

            {/* Note text input */}
            <TextInput
              style={[styles.input, !state[target.key].active && styles.inputDim]}
              placeholder={`Message to ${target.label}…`}
              placeholderTextColor={Theme.colors.text.muted}
              value={state[target.key].text}
              onChangeText={(v) => setField(target.key, 'text', v)}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
          </View>
        ))}
      </ScrollView>

      {/* Footer push button */}
      <TouchableOpacity
        style={styles.footer}
        onPress={handlePush}
        disabled={upsert.isPending || isLoading}
        activeOpacity={0.7}
      >
        {upsert.isPending ? (
          <ActivityIndicator color={Theme.colors.text.mint} />
        ) : (
          <ThemedText variant="body" color="mint" style={styles.footerTxt}>
            Save  ›
          </ThemedText>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  scroll: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.md,
  },

  hint: {
    fontSize: S,
    paddingVertical: Theme.spacing.xs,
    lineHeight: S * 1.3,
  },

  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    paddingVertical: Theme.spacing.xs + 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  groupLabel: { fontSize: B },

  input: {
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    paddingVertical: 2,
    minHeight: 36,
  },
  inputDim: { opacity: 0.4 },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
  footerTxt: { fontSize: B, textAlign: 'right' },
});
