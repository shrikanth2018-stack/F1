/**
 * 1stOne F1 — Delivery cycle card
 *
 * One delivery cycle's inline-editable card: name, active toggle, three
 * editable times (cut-off / kitchen push / dispatch), and the essentials
 * toggle + label. Extracted from DeliveryManagerScreen (audit D22) — the
 * TimeField sub-component lives here too.
 */

import React, { useState } from 'react';
import { View, TextInput, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { useUpdateDeliveryCycle } from '../../../hooks/useMenuManagement';
import type { DeliveryCycle } from '../../../types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

function toHHMM(t?: string): string {
  if (!t) return '';
  return t.slice(0, 5);
}

// ── TimeField ────────────────────────────────────────────────
function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  return (
    <View style={tf.row}>
      <ThemedText variant="small" color="muted" style={tf.label}>{label}</ThemedText>
      {editing ? (
        <TextInput
          style={tf.input}
          value={draft}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          autoFocus
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          placeholder="HH:MM"
          placeholderTextColor={Theme.colors.text.muted}
        />
      ) : (
        <TouchableOpacity onPress={() => { setDraft(toHHMM(value)); setEditing(true); }} activeOpacity={0.7}>
          <ThemedText variant="body" color="mint" style={tf.time}>
            {toHHMM(value) || '—'}{'  ✎'}
          </ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}

const tf = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.xs + 2,
  },
  label: { fontSize: S },
  time: { fontSize: B },
  input: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: 2,
    minWidth: 70,
    textAlign: 'right',
  },
});

// ── CycleCard ────────────────────────────────────────────────
export function CycleCard({ cycle }: { cycle: DeliveryCycle }) {
  const update = useUpdateDeliveryCycle();
  const [essLabel, setEssLabel] = useState(cycle.essentials_label ?? '');
  const [cycleName, setCycleName] = useState(cycle.cycle_name);

  const save = (field: string, val: string) => {
    const formatted = val.length === 5 ? `${val}:00` : val;
    update.mutate({ id: cycle.id, [field]: formatted });
  };

  const saveEssLabel = () => {
    const trimmed = essLabel.trim();
    update.mutate({ id: cycle.id, essentials_label: trimmed.length > 0 ? trimmed : null });
  };

  const saveCycleName = () => {
    const trimmed = cycleName.trim();
    if (trimmed.length > 0 && trimmed !== cycle.cycle_name) {
      update.mutate({ id: cycle.id, cycle_name: trimmed });
    } else {
      setCycleName(cycle.cycle_name);
    }
  };

  return (
    <View style={card.container}>
      <View style={card.header}>
        <TextInput
          value={cycleName}
          onChangeText={setCycleName}
          onBlur={saveCycleName}
          style={card.nameInput}
          placeholder="Cycle name"
          placeholderTextColor={Theme.colors.text.muted}
        />
        <Switch
          value={cycle.is_active}
          onValueChange={(v) => update.mutate({ id: cycle.id, is_active: v })}
          trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
          thumbColor={Theme.colors.text.primary}
        />
      </View>
      <TimeField label="Order Cut-off" value={cycle.cutoff_time} onCommit={(v) => save('cutoff_time', v)} />
      <TimeField label="Kitchen Push" value={cycle.kitchen_push_time} onCommit={(v) => save('kitchen_push_time', v)} />
      <TimeField label="Dispatch" value={cycle.delivery_start} onCommit={(v) => save('delivery_start', v)} />

      {/* Essentials label — only meaningful when cycle supports essentials */}
      <View style={card.labelRow}>
        <ThemedText variant="small" color="muted" style={card.labelName}>Essentials Toggle</ThemedText>
        <Switch
          value={cycle.is_essentials}
          onValueChange={(v) => update.mutate({ id: cycle.id, is_essentials: v })}
          trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
          thumbColor={Theme.colors.text.primary}
        />
      </View>
      {cycle.is_essentials && (
        <View style={card.labelRow}>
          <ThemedText variant="small" color="muted" style={card.labelName}>Essentials Label</ThemedText>
          <TextInput
            value={essLabel}
            onChangeText={setEssLabel}
            onBlur={saveEssLabel}
            placeholder="e.g. Morning"
            placeholderTextColor={Theme.colors.text.muted}
            style={card.labelInput}
          />
        </View>
      )}
    </View>
  );
}

const card = StyleSheet.create({
  container: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.xs,
  },
  nameInput: {
    flex: 1,
    fontSize: B,
    color: Theme.colors.text.primary,
    paddingVertical: 0,
    marginRight: Theme.spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.xs,
  },
  labelName: { fontSize: S, minWidth: 130 },
  labelInput: {
    flex: 1,
    fontSize: S,
    color: Theme.colors.text.primary,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    textAlign: 'right',
  },
});
