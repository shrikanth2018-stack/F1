/**
 * 1stOne F1 — Note to Staff Screen
 *
 * Admin composes a note per staff group (All Staff / Kitchen / Packing / Delivery).
 * Each group has an enable/disable toggle and a text input.
 * "Push ›" upserts all groups — active notes appear as a banner in the matching
 * tab on the StaffDashboard in real time.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { supabase } from '../../api/supabaseClient';
import {
  useAdminNotes,
  useUpsertNote,
  NOTE_TARGETS,
  type NoteTarget,
} from '../../hooks/useAdminNotes';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type NoteState = { text: string; active: boolean };

export function NoteToStaffScreen({ navigation }: { navigation: AdminNavProp }) {
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
      Alert.alert('Nothing to push', 'Enter a message for at least one group.');
      return;
    }

    try {
      await Promise.all(
        targets.map((t) =>
          upsert.mutateAsync({
            target_tab: t.key,
            note_text: state[t.key].text.trim(),
            is_active: state[t.key].active,
          })
        )
      );

      // Fire push to staff for active notes only
      const activeTargets = targets.filter((t) => state[t.key].active);
      if (activeTargets.length > 0) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          // Send one combined push covering the first active note's message
          const first = activeTargets[0];
          supabase.functions.invoke('send-push', {
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: {
              role: 'staff',
              title: 'Note from Admin',
              body: state[first.key].text.trim(),
              data: { screen: 'StaffDashboard' },
              trigger_source: 'admin_push',
            },
          }).catch((e: any) => console.error('[NoteToStaff] push failed:', e));
        }
      }

      Alert.alert('Done', 'Notes updated for staff dashboard.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save notes.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Note to Staff
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ThemedText variant="small" color="muted" style={styles.hint}>
          Active notes appear as a banner in each staff tab. Toggle on to make a note visible; toggle off to hide it.
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
              numberOfLines={3}
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
            Push  ›
          </ThemedText>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  scroll: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl * 2,
  },

  hint: {
    fontSize: S,
    paddingVertical: Theme.spacing.md,
    lineHeight: S * 1.5,
  },

  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    paddingVertical: Theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.sm,
  },
  groupLabel: { fontSize: B, fontWeight: '600' },

  input: {
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    paddingVertical: Theme.spacing.xs + 2,
    minHeight: 64,
  },
  inputDim: { opacity: 0.4 },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
  footerTxt: { fontSize: B },
});
