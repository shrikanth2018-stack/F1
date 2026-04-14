/**
 * 1stOne F1 — Delivery Manager
 *
 * 4-tab screen: Food Cycles | Essentials Cycles | Zones & Fees | Hubs
 *
 * Food Cycles / Essentials Cycles: same delivery_cycle records, different display
 * names. Each cycle row shows inline-editable Order Cut-off, Kitchen Push, and
 * Dispatch times (HH:MM). Changes saved on blur via useUpdateDeliveryCycle.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { useAllDeliveryCycles, useUpdateDeliveryCycle } from '../../hooks/useMenuManagement';
import { CYCLE_DISPLAY } from '../../hooks/useEssentialsCatalog';
import type { DeliveryCycle } from '../../types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

const MEAL_CYCLES = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'];

type DeliveryTab = 'Food Cycles' | 'Essentials Cycles' | 'Zones & Fees' | 'Hubs';
const TABS: DeliveryTab[] = ['Food Cycles', 'Essentials Cycles', 'Zones & Fees', 'Hubs'];

/** Strip seconds from "HH:MM:SS" → "HH:MM" */
function toHHMM(t?: string): string {
  if (!t) return '';
  return t.slice(0, 5);
}

// ── Inline time field ────────────────────────────────────
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

// ── Cycle card ───────────────────────────────────────────
function CycleCard({
  cycle,
  displayName,
}: {
  cycle: DeliveryCycle;
  displayName: string;
}) {
  const update = useUpdateDeliveryCycle();

  const save = (field: string, val: string) => {
    // Ensure HH:MM:SS format for storage
    const formatted = val.length === 5 ? `${val}:00` : val;
    update.mutate({ id: cycle.id, [field]: formatted });
  };

  return (
    <View style={card.container}>
      <View style={card.header}>
        <ThemedText variant="body" color="primary" style={card.name}>{displayName}</ThemedText>
        <Switch
          value={cycle.is_active}
          onValueChange={(v) => update.mutate({ id: cycle.id, is_active: v })}
          trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
          thumbColor={Theme.colors.text.primary}
        />
      </View>
      <TimeField
        label="Order Cut-off"
        value={cycle.cutoff_time}
        onCommit={(v) => save('cutoff_time', v)}
      />
      <TimeField
        label="Kitchen Push"
        value={cycle.kitchen_push_time}
        onCommit={(v) => save('kitchen_push_time', v)}
      />
      <TimeField
        label="Dispatch"
        value={cycle.delivery_start}
        onCommit={(v) => save('delivery_start', v)}
      />
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
  name: { fontSize: B, fontWeight: '600' },
});

// ── Placeholder tab ──────────────────────────────────────
function PlaceholderTab({ label }: { label: string }) {
  return (
    <View style={ph.wrap}>
      <ThemedText variant="body" color="muted" style={ph.txt}>{label} — coming soon</ThemedText>
    </View>
  );
}
const ph = StyleSheet.create({
  wrap: { flex: 1, padding: Theme.spacing.md },
  txt: { fontSize: B },
});

// ── Main screen ──────────────────────────────────────────
export function DeliveryManagerScreen({ navigation }: { navigation: any }) {
  const [activeTab, setActiveTab] = useState<DeliveryTab>('Food Cycles');

  const { data: allCycles = [] } = useAllDeliveryCycles();
  const cycles = useMemo(
    () => (allCycles as DeliveryCycle[]).filter((c) =>
      MEAL_CYCLES.some((m) => c.cycle_name?.toLowerCase().includes(m.toLowerCase()))
    ),
    [allCycles]
  );

  const renderCycles = (essentials: boolean) =>
    cycles.map((c) => (
      <CycleCard
        key={c.id}
        cycle={c}
        displayName={essentials ? (CYCLE_DISPLAY[c.cycle_name] ?? c.cycle_name) : c.cycle_name}
      />
    ));

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Delivery Manager
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map((tab, idx) => (
          <React.Fragment key={tab}>
            {idx > 0 && (
              <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>
            )}
            <TouchableOpacity style={styles.topTab} onPress={() => setActiveTab(tab)}>
              <ThemedText
                variant="body"
                color={activeTab === tab ? 'primary' : 'muted'}
                style={[styles.tabText, activeTab === tab && styles.tabActive]}
              >
                {tab}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </ScrollView>

      {/* Tab content */}
      {activeTab === 'Food Cycles' || activeTab === 'Essentials Cycles' ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          {renderCycles(activeTab === 'Essentials Cycles')}
        </ScrollView>
      ) : (
        <PlaceholderTab label={activeTab} />
      )}
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

  tabBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    flexGrow: 0,
  },
  tabBarContent: {
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  topTab: { paddingHorizontal: Theme.spacing.sm },
  tabText: { fontSize: B + 4 },
  tabActive: { fontWeight: '600' },
});
