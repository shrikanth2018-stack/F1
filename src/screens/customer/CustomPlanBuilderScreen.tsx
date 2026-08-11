/**
 * 1stOne F1 — Build your own plan
 *
 * Pick a delivery time, up to three items, and how long you want it. The
 * price follows.
 *
 * THE PRICE HERE IS A PREVIEW, NOT AN OFFER. Every number on this screen is
 * recomputed by create_custom_plan from the catalogue and the admin's slab
 * before a plan exists — the phone sends a spec and never a price, exactly as
 * the cart does. The local copy is only so the total moves while the customer
 * drags the length; if the two ever disagree the server's answer is the one
 * that gets bought.
 *
 * WHAT IT REFUSES, and why each is worth saying out loud rather than just
 * disabling a button: at least one meal (a plan is food with essentials
 * alongside, not a milk round), one delivery time, up to three items, 10 to
 * 45 days, and one running custom plan per time of day. The server enforces
 * all of them; this screen states them so nobody gets that far and is told no.
 *
 * Once built, the plan is an ordinary plan — the customer lands on
 * PlanDetail, picks a start date and buys it through the same checkout as
 * everything else. That is the whole reason the plan row is created here
 * rather than at checkout: the cart carries a plan_id it already understands,
 * and quote-order and place-order need no changes at all.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { CatalogPhotoThumb } from '../../components/CatalogPhotoThumb';
import { PHOTO_BUCKET, PHOTO_PX } from '../../utils/catalogPhoto';
import { formatPriceShort, getErrorMessage } from '../../utils/formatters';
import { formatTime12h } from '../../utils/timeEngine';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import {
  useBuilderItems,
  useDiscountSlabs,
  useCreateCustomPlan,
  discountForDays,
  type EligibleItem,
} from '../../hooks/useCustomPlanConfig';
import type { CustomerScreenProps } from '../../navigation/types';

/** Mirrored in create_custom_plan; the server is the one that enforces them. */
const MIN_DAYS = 10;
const MAX_DAYS = 45;
const MAX_ITEMS = 3;
const DAY_STEPS = [10, 15, 20, 30, 45];

interface Chosen { item: EligibleItem; quantity: number }

export function CustomPlanBuilderScreen({ navigation }: CustomerScreenProps<'CustomPlanBuilder'>) {
  const { data: cycles = [] } = useDeliveryCycles();
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [chosen, setChosen] = useState<Record<string, Chosen>>({});
  const [days, setDays] = useState(30);

  const { data: items = [], isLoading } = useBuilderItems(cycleId);
  const { data: slabs = [] } = useDiscountSlabs();
  const { mutateAsync: create, isPending } = useCreateCustomPlan();

  const activeCycle = cycles.find((c) => c.id === cycleId);
  const picked = useMemo(() => Object.values(chosen), [chosen]);
  const foodCount = picked.filter((p) => p.item.item_type === 'food').length;

  const daily = picked.reduce((s, p) => s + p.item.price * p.quantity, 0);
  const pct = discountForDays(days, slabs);
  const full = Math.round(daily * days * 100) / 100;
  const price = Math.round(full * (1 - pct / 100) * 100) / 100;
  const savings = Math.round((full - price) * 100) / 100;

  /**
   * Changing the delivery time clears the basket, and has to: eligibility is
   * per cycle, so a dish chosen for breakfast is not on offer at dinner and
   * the server would refuse the whole plan at the last step.
   */
  const pickCycle = (id: number) => {
    if (id === cycleId) return;
    setCycleId(id);
    setChosen({});
  };

  const keyOf = (i: EligibleItem) => `${i.item_type}:${i.id}`;

  const toggle = (item: EligibleItem) => {
    const k = keyOf(item);
    setChosen((cur) => {
      if (cur[k]) {
        const next = { ...cur };
        delete next[k];
        return next;
      }
      if (Object.keys(cur).length >= MAX_ITEMS) {
        Alert.alert('Three is the limit', `A plan can hold up to ${MAX_ITEMS} items.`);
        return cur;
      }
      return { ...cur, [k]: { item, quantity: 1 } };
    });
  };

  const setQty = (item: EligibleItem, q: number) => {
    const k = keyOf(item);
    setChosen((cur) => (cur[k] ? { ...cur, [k]: { ...cur[k], quantity: Math.max(1, q) } } : cur));
  };

  const blocker =
    cycleId == null ? 'Choose a delivery time'
      : picked.length === 0 ? 'Add at least one item'
        : foodCount === 0 ? 'Add at least one meal — essentials come alongside'
          : null;

  const onBuild = async () => {
    if (blocker || cycleId == null) return;
    try {
      const plan = await create({
        cycleId,
        durationDays: days,
        items: picked.map((p) => ({
          item_id: p.item.id, item_type: p.item.item_type, quantity: p.quantity,
        })),
      });
      // An ordinary plan from here: same detail screen, same start-date
      // calendar, same checkout as anything on the listed range.
      navigation.replace('PlanDetail', { planId: plan.plan_id });
    } catch (e) {
      // The server's own sentence — it names the rule that was hit.
      Alert.alert('Could not build that plan', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Build a plan</ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* ── When ── */}
        <ThemedText variant="small" color="muted" style={styles.label}>DELIVERED AT</ThemedText>
        <View style={styles.chipRow}>
          {cycles.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, cycleId === c.id && styles.chipOn]}
              onPress={() => pickCycle(c.id)}
              activeOpacity={0.7}
            >
              <ThemedText variant="small" color={cycleId === c.id ? 'mint' : 'muted'}>
                {c.cycle_name}
              </ThemedText>
              <ThemedText variant="micro" color="muted">{formatTime12h(c.delivery_start)}</ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── What ── */}
        {cycleId != null && (
          <>
            <Divider />
            <ThemedText variant="small" color="muted" style={styles.label}>
              CHOOSE UP TO {MAX_ITEMS} · {picked.length} PICKED
            </ThemedText>

            {isLoading ? (
              <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
            ) : items.length === 0 ? (
              <EmptyState
                title="Nothing available yet"
                subtitle={`No ${activeCycle?.cycle_name ?? 'items'} are offered for plans at the moment.`}
              />
            ) : (
              items.map((it) => {
                const k = keyOf(it);
                const sel = chosen[k];
                return (
                  <View key={k} style={styles.itemRow}>
                    <TouchableOpacity
                      style={[styles.tile, sel && styles.tileOn]}
                      onPress={() => toggle(it)}
                      activeOpacity={0.7}
                    >
                      <CatalogPhotoThumb
                        bucket={it.item_type === 'food' ? PHOTO_BUCKET.menu : PHOTO_BUCKET.essentials}
                        item={it}
                        size={40}
                        requestPx={PHOTO_PX.admin}
                        fallbackIcon={it.item_type === 'food' ? 'restaurant-outline' : 'basket-outline'}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.itemInfo} onPress={() => toggle(it)} activeOpacity={0.7}>
                      <ThemedText variant="body" color={sel ? 'primary' : 'subtitle'} numberOfLines={1}>
                        {it.name}
                      </ThemedText>
                      <ThemedText variant="micro" color="muted">
                        {it.item_type === 'food' ? 'Meal' : 'Essential'} · {formatPriceShort(it.price)} a day
                      </ThemedText>
                    </TouchableOpacity>
                    {sel && (
                      <View style={styles.stepper}>
                        <TouchableOpacity style={styles.stepBtn} onPress={() => setQty(it, sel.quantity - 1)}>
                          <ThemedText variant="body" color="primary">−</ThemedText>
                        </TouchableOpacity>
                        <ThemedText variant="body" color="primary" style={styles.qty}>{sel.quantity}</ThemedText>
                        <TouchableOpacity style={styles.stepBtn} onPress={() => setQty(it, sel.quantity + 1)}>
                          <ThemedText variant="body" color="primary">+</ThemedText>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </>
        )}

        {/* ── How long ── */}
        {picked.length > 0 && (
          <>
            <Divider />
            <ThemedText variant="small" color="muted" style={styles.label}>
              FOR HOW LONG · {MIN_DAYS}–{MAX_DAYS} DAYS
            </ThemedText>
            <View style={styles.chipRow}>
              {DAY_STEPS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.chip, days === d && styles.chipOn]}
                  onPress={() => setDays(d)}
                  activeOpacity={0.7}
                >
                  <ThemedText variant="small" color={days === d ? 'mint' : 'muted'}>{d} days</ThemedText>
                  <ThemedText variant="micro" color="muted">
                    {discountForDays(d, slabs) > 0 ? `${discountForDays(d, slabs)}% off` : 'no discount'}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── The money ── */}
            <View style={styles.totals}>
              <View style={styles.totalRow}>
                <ThemedText variant="small" color="subtitle">
                  {formatPriceShort(daily)} a day × {days}
                </ThemedText>
                <ThemedText variant="small" color="subtitle">{formatPriceShort(full)}</ThemedText>
              </View>
              {pct > 0 && (
                <View style={styles.totalRow}>
                  <ThemedText variant="small" color="mint">{pct}% plan discount</ThemedText>
                  <ThemedText variant="small" color="mint">−{formatPriceShort(savings)}</ThemedText>
                </View>
              )}
              <View style={styles.totalRow}>
                <ThemedText variant="subtitle" color="primary">Plan price</ThemedText>
                <ThemedText variant="subtitle" color="accent">{formatPriceShort(price)}</ThemedText>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.floatBtn}
        activeOpacity={0.85}
        disabled={!!blocker || isPending}
        onPress={onBuild}
      >
        {isPending
          ? <ActivityIndicator color={Theme.colors.text.mint} />
          : (
            <ThemedText variant="body" style={styles.floatBtnText}>
              {blocker ?? `Continue · ${formatPriceShort(price)}  ›`}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  spacer: { width: 44 },
  content: { padding: Theme.spacing.md, paddingBottom: 96 },
  label: { letterSpacing: 1, marginTop: Theme.spacing.sm, marginBottom: Theme.spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.xs },
  chip: {
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
    alignItems: 'center',
  },
  chipOn: {
    borderColor: `${Theme.colors.text.mint}80`,
    backgroundColor: `${Theme.colors.text.mint}14`,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  tile: { borderRadius: 10, borderWidth: 1.5, borderColor: 'transparent' },
  tileOn: { borderColor: Theme.colors.text.mint },
  itemInfo: { flex: 1 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 8,
  },
  stepBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  qty: { minWidth: 22, textAlign: 'center' },
  loader: { marginTop: Theme.spacing.lg },
  totals: { marginTop: Theme.spacing.md, gap: 4 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  floatBtn: {
    position: 'absolute',
    left: Theme.spacing.md,
    right: Theme.spacing.md,
    bottom: Theme.spacing.lg,
    height: 44,
    borderRadius: 22,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatBtnText: { color: Theme.colors.text.mint },
});
