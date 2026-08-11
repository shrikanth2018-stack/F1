/**
 * 1stOne F1 — Manage → Subscriptions → Custom
 *
 * Everything that governs the CUSTOMER's plan builder, in one place, because
 * the two settings only make sense together: what a length is worth, and what
 * may be put in a plan at all.
 *
 * WHAT THIS DOES NOT TOUCH. Listed plans keep their typed price. The schedule
 * here prices custom plans only and appears as a suggestion when an admin
 * composes a listed one — a curated plan is a commercial offer, and pricing
 * one below formula as a loss-leader is a lever worth keeping. Nothing here
 * reprices Breakfast 30.
 *
 * ELIGIBILITY IS OFF BY DEFAULT and lists only customer-visible menus. An
 * admin builds a LISTED plan out of building blocks — Idli, Sambar — which a
 * customer never sees and cannot pick, so blocks are absent here on purpose.
 */

import React, { useMemo, useState } from 'react';
import { View, ScrollView, TextInput, Switch, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { Divider } from '../../../components/Divider';
import { ErrorRetry } from '../../../components/ErrorRetry';
import { formatPriceShort, getErrorMessage } from '../../../utils/formatters';
import { useDeliveryCycles } from '../../../hooks/useDeliveryCycles';
import {
  useDiscountSlabs,
  useUpdateSlab,
  usePlanEligibility,
  useSetPlanEligible,
  discountForDays,
  type DiscountSlab,
} from '../../../hooks/useCustomPlanConfig';

/** The builder's bounds. Mirrored server-side; shown here so the schedule can
 *  be checked against the lengths a customer can actually choose. */
const MIN_PLAN_DAYS = 10;
const MAX_PLAN_DAYS = 45;

function SlabRow({ slab }: { slab: DiscountSlab }) {
  const [min, setMin] = useState(String(slab.min_days));
  const [max, setMax] = useState(String(slab.max_days));
  const [pct, setPct] = useState(String(Number(slab.percent)));
  const { mutateAsync: save, isPending } = useUpdateSlab();

  const dirty =
    min !== String(slab.min_days) ||
    max !== String(slab.max_days) ||
    pct !== String(Number(slab.percent));

  const onSave = async () => {
    const a = parseInt(min, 10);
    const b = parseInt(max, 10);
    const p = parseFloat(pct);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(p)) {
      Alert.alert('Check the numbers', 'Days and percentage must all be numbers.');
      return;
    }
    if (b < a) {
      Alert.alert('Check the range', 'The last day cannot be before the first.');
      return;
    }
    if (p < 0 || p >= 100) {
      Alert.alert('Check the discount', 'A discount must be between 0 and 99%.');
      return;
    }
    try {
      await save({ id: slab.id, min_days: a, max_days: b, percent: p });
    } catch (e) {
      Alert.alert('Not saved', getErrorMessage(e));
    }
  };

  return (
    <View style={styles.slabRow}>
      <TextInput
        style={styles.dayInput}
        value={min}
        onChangeText={setMin}
        keyboardType="number-pad"
        placeholderTextColor={Theme.colors.text.muted}
      />
      <ThemedText variant="small" color="muted">to</ThemedText>
      <TextInput
        style={styles.dayInput}
        value={max}
        onChangeText={setMax}
        keyboardType="number-pad"
        placeholderTextColor={Theme.colors.text.muted}
      />
      <ThemedText variant="small" color="muted">days</ThemedText>
      <TextInput
        style={styles.pctInput}
        value={pct}
        onChangeText={setPct}
        keyboardType="decimal-pad"
        placeholderTextColor={Theme.colors.text.muted}
      />
      <ThemedText variant="small" color="muted">%</ThemedText>
      <View style={styles.slabAction}>
        {dirty && (
          <TouchableOpacity onPress={onSave} disabled={isPending}>
            <ThemedText variant="small" color="mint">{isPending ? '…' : 'Save'}</ThemedText>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export function CustomPlanSettingsTab() {
  const slabsQ = useDiscountSlabs();
  const itemsQ = usePlanEligibility();
  const { data: cycles = [] } = useDeliveryCycles();
  const { mutateAsync: setEligible } = useSetPlanEligible();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const slabs = useMemo(() => slabsQ.data ?? [], [slabsQ.data]);

  /**
   * Which lengths the schedule leaves at zero.
   *
   * A gap is not an error — plan_discount_percent returns 0 rather than
   * failing, so a purchase always works. But a customer picking 22 days and
   * being quietly offered nothing off is a configuration mistake nobody would
   * otherwise see, so it is named here rather than discovered later.
   */
  const uncovered = useMemo(() => {
    const gaps: number[] = [];
    for (let d = MIN_PLAN_DAYS; d <= MAX_PLAN_DAYS; d++) {
      if (discountForDays(d, slabs) === 0) gaps.push(d);
    }
    return gaps;
  }, [slabs]);

  const byCycle = useMemo(() => {
    const m = new Map<number, typeof itemsQ.data>();
    for (const it of itemsQ.data ?? []) {
      if (it.cycle_id == null) continue;
      m.set(it.cycle_id, [...(m.get(it.cycle_id) ?? []), it]);
    }
    return m;
  }, [itemsQ.data]);

  const eligibleCount = (itemsQ.data ?? []).filter((i) => i.plan_eligible).length;

  if (slabsQ.error || itemsQ.error) {
    return (
      <ErrorRetry
        message="Could not load custom-plan settings"
        onRetry={() => { slabsQ.refetch(); itemsQ.refetch(); }}
      />
    );
  }

  const toggle = async (id: number, item_type: 'food' | 'essential', next: boolean) => {
    const key = `${item_type}:${id}`;
    setBusyKey(key);
    try {
      await setEligible({ id, item_type, eligible: next });
    } catch (e) {
      Alert.alert('Not saved', getErrorMessage(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* ── Discount schedule ── */}
      <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
        DISCOUNT BY LENGTH
      </ThemedText>
      <ThemedText variant="micro" color="muted" style={styles.hint}>
        Applies to plans a customer builds. Listed plans keep the price you set;
        this shows there as a suggestion.
      </ThemedText>
      {slabs.map((s) => <SlabRow key={s.id} slab={s} />)}

      {uncovered.length > 0 && (
        <ThemedText variant="micro" color="warning" style={styles.hint}>
          {uncovered.length} length{uncovered.length === 1 ? '' : 's'} between {MIN_PLAN_DAYS} and{' '}
          {MAX_PLAN_DAYS} days get no discount ({uncovered.slice(0, 8).join(', ')}
          {uncovered.length > 8 ? '…' : ''}). A customer can still buy — they simply pay full price.
        </ThemedText>
      )}

      <Divider />

      {/* ── Eligibility ── */}
      <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
        ITEMS A CUSTOMER MAY PUT IN A PLAN
      </ThemedText>
      <ThemedText variant="micro" color="muted" style={styles.hint}>
        {eligibleCount} allowed. Off by default — switch on only what you are happy
        to commit to daily for up to {MAX_PLAN_DAYS} days. Building blocks are not
        listed: a customer picks from the menu, never from ingredients.
      </ThemedText>

      {cycles.map((c) => {
        const items = byCycle.get(c.id) ?? [];
        if (items.length === 0) return null;
        return (
          <View key={c.id} style={styles.cycleBlock}>
            <ThemedText variant="small" color="mint" style={styles.cycleName}>
              {c.cycle_name}
            </ThemedText>
            {items.map((it) => {
              const key = `${it.item_type}:${it.id}`;
              return (
                <View key={key} style={styles.itemRow}>
                  <View style={styles.itemInfo}>
                    <ThemedText variant="body" color="primary" numberOfLines={1}>
                      {it.name}
                    </ThemedText>
                    <ThemedText variant="micro" color="muted">
                      {it.item_type === 'food' ? 'Menu' : 'Essential'} · {formatPriceShort(it.price)}
                    </ThemedText>
                  </View>
                  <Switch
                    value={it.plan_eligible}
                    disabled={busyKey === key}
                    onValueChange={(v) => toggle(it.id, it.item_type, v)}
                    trackColor={{ false: Theme.colors.layout.divider, true: `${Theme.colors.text.mint}80` }}
                    thumbColor={it.plan_eligible ? Theme.colors.text.mint : Theme.colors.text.muted}
                  />
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },
  sectionLabel: { letterSpacing: 1, marginTop: Theme.spacing.sm },
  hint: { marginTop: 2, marginBottom: Theme.spacing.sm },
  slabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.xs,
    paddingVertical: Theme.spacing.xs,
  },
  dayInput: {
    width: 46,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: 'center',
  },
  pctInput: {
    width: 56,
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: 'center',
  },
  slabAction: { flex: 1, alignItems: 'flex-end' },
  cycleBlock: { marginTop: Theme.spacing.sm },
  cycleName: { letterSpacing: 0.5, marginBottom: Theme.spacing.xs },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  itemInfo: { flex: 1, marginRight: Theme.spacing.sm },
});
