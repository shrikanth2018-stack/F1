/**
 * 1stOne F1 — Create Subscription Plan Screen
 *
 * A plan is a composition, exactly as a menu is — so a FOOD plan is built from
 * building-block ITEMS, not from menus. Building one out of menus nested one
 * stage-2 composition inside another and hid from the kitchen what a
 * subscriber actually receives each day.
 *
 * CONTENTS ARE PICKED, NEVER TYPED, and found by typing rather than by
 * scrolling a list of thirty-four — the same picker as the menu builder, on
 * purpose: they are the same job at a different moment.
 *
 * A LINE IS A COUNT OF THE BLOCK'S OWN PORTION — "Sambar 150 ml × 1". The
 * portion belongs to the block and is shown here as a fact.
 *
 * THE CYCLE NO LONGER FILTERS THE LIST. Blocks carry no cycle — an ingredient
 * is not a mealtime — so the toggle does only what it should: set the plan's
 * `cycle_id`, which is what decides when the plan dispatches. The cycle is a
 * property of the PLAN, the same reasoning as `overrideCycleId` on the admin
 * order path.
 *
 * THE PRICE IS THE DAILY TOTAL TIMES THE DAYS, and it is prefilled rather than
 * forced. It used to be the daily total alone, charged once for the whole run:
 * plan #25 was ₹115 for thirty days of a ₹115 breakfast. Once the field has
 * been typed in it is left alone, the same restraint the recipe editor uses.
 *
 * ESSENTIALS NOW HAS AN ITEM PICKER, which it did not before. Its items are
 * customer-facing catalogue rows, so there is no two-stage structure to
 * correct — but the picker was rendered only for food, so an essentials plan
 * could only ever be saved with an EMPTY plan_items. `generate_daily_manifest`
 * mirrors that column into order_items, so such a plan dispatched an order
 * containing nothing, every day, for its whole duration. Both types now
 * require at least one item, because a plan that delivers nothing is not a
 * plan. An essential's `unit` is a pack description ("1L") rather than a
 * measured portion, which is the one place the two types still differ below.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { infoDialog } from '../../utils/confirmDialog';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { useAddPlan, type PlanType } from '../../hooks/useSubscriptionPlans';
import {
  useAllDeliveryCycles,
  useMenuBlocks,
  useMenusForCycle,
} from '../../hooks/useMenuManagement';
import { useAllEssentials, CYCLE_DISPLAY } from '../../hooks/useEssentialsCatalog';
import { formatPriceShort } from '../../utils/formatters';
import { toMenuUnit } from '../../utils/menuRecipe';
import {
  dailyTotal,
  planPriceFor,
  fromRecipe,
  portionOf,
  type PlanLine,
  type BlockLike,
  type Adjusted,
} from '../../utils/planItems';
import type { AdminScreenProps } from '../../navigation/types';
import type { MenuItem } from '../../types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

export function CreatePlanScreen({ navigation, route }: AdminScreenProps<'CreatePlan'>) {
  const planType: PlanType = route.params?.planType ?? 'food';
  const isFood = planType === 'food';

  const { data: rawCycles = [] } = useAllDeliveryCycles();
  // Active delivery cycles (already branch-scoped & sort_order-ordered by
  // useAllDeliveryCycles). Filter on is_active, not a cycle-name substring —
  // renaming a cycle must never drop it from the picker.
  const cycles = useMemo(
    () => rawCycles.filter((c: any) => c.is_active),
    [rawCycles]
  );

  const [cycleIdx, setCycleIdx] = useState(0);
  const [planName, setPlanName] = useState('');
  const [daysInput, setDaysInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [savingsInput, setSavingsInput] = useState('');
  const [selectedItems, setSelectedItems] = useState<PlanLine[]>([]);
  const [find, setFind] = useState('');
  const [menuPickerOpen, setMenuPickerOpen] = useState(false);
  const [adjusted, setAdjusted] = useState<Adjusted[]>([]);
  /**
   * Whether the admin has taken the price over.
   *
   * Until they do, the box tracks items × days. Once typed in it is theirs —
   * a combo is often priced below the sum of its parts, and silently
   * recomputing over a deliberate number would be worse than not prefilling
   * at all.
   */
  const priceTouched = useRef(false);

  const selectedCycle = cycles[cycleIdx] as any;

  // Sync cycle from route params
  useEffect(() => {
    if (!cycles.length) return;
    const paramId = route.params?.cycleId;
    if (!paramId) return;
    const idx = cycles.findIndex((c: any) => c.id === paramId);
    if (idx >= 0) setCycleIdx(idx);
  }, [cycles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The parts a plan is built from ──────────────────────────
  // Food: building blocks — cycle-less, so the cycle toggle does not filter
  // them. Essentials: the cycle's catalogue rows, unchanged.
  const { data: allBlocks = [] } = useMenuBlocks();
  const blocks = useMemo<BlockLike[]>(
    () => (allBlocks as MenuItem[]).filter((b) => b.is_active),
    [allBlocks],
  );
  const { data: essentialItems = [] } = useAllEssentials(selectedCycle?.id);
  const essentials = useMemo<BlockLike[]>(
    () => (essentialItems as any[]).filter((i) => i.is_active),
    [essentialItems],
  );
  const source: BlockLike[] = isFood ? blocks : essentials;

  // Menus of this cycle — only as a starting point for the picker below.
  const { data: cycleMenus = [] } = useMenusForCycle(selectedCycle?.id);

  const addPlan = useAddPlan();

  // ── Money ───────────────────────────────────────────────────
  const perDay = useMemo(() => dailyTotal(selectedItems, source), [selectedItems, source]);
  const days = parseInt(daysInput, 10);
  const suggested = useMemo(
    () => (Number.isFinite(days) && days > 0 ? planPriceFor(perDay, days) : 0),
    [perDay, days],
  );

  // Keep the box in step until the admin takes it over.
  useEffect(() => {
    if (priceTouched.current) return;
    setPriceInput(suggested > 0 ? String(suggested) : '');
  }, [suggested]);

  // ── Picker ──────────────────────────────────────────────────
  // Nothing until you type. Names that START with what was typed come first,
  // because that is what someone typing "sa" for Sambar expects at the top.
  const matches = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q) return [];
    return source
      .filter((b) => !selectedItems.some((si) => si.item_id === b.id))
      .filter((b) => b.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const sa = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const sb = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return sa - sb || a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }, [source, selectedItems, find]);

  /**
   * The portion snapshot is FOOD ONLY.
   *
   * `essentials_catalog.unit` is free text describing the pack — "1L",
   * "500g" — not one of the kitchen's measured units, and there is no
   * base_quantity behind it. Running it through `toMenuUnit` would turn "1L"
   * into "nos" and print "Milk 1 nos" to a customer. Leaving both fields off
   * makes `formatPlanLine` fall back to a plain count, which is the honest
   * reading for a packaged item.
   */
  const handleAddItem = (b: BlockLike) => {
    if (selectedItems.some((si) => si.item_id === b.id)) return;
    setSelectedItems((prev) => [
      ...prev,
      isFood
        ? {
            item_id: b.id,
            item_name: b.name,
            quantity: 1,
            unit: toMenuUnit(b.unit),
            base_quantity: portionOf(b),
          }
        : { item_id: b.id, item_name: b.name, quantity: 1 },
    ]);
    setFind('');
  };

  const handleQtyChange = (itemId: number, delta: number) => {
    setSelectedItems((prev) =>
      prev.map((si) =>
        si.item_id === itemId ? { ...si, quantity: Math.max(1, si.quantity + delta) } : si
      )
    );
  };

  const handleRemoveItem = (itemId: number) => {
    setSelectedItems((prev) => prev.filter((si) => si.item_id !== itemId));
  };

  /**
   * Pull a menu's recipe in as editable rows.
   *
   * A shortcut only — the saved plan holds block ids, never the menu's. Rows
   * whose amount is not a whole number of portions get rounded, and are named
   * afterwards rather than changed quietly.
   */
  const handleStartFromMenu = (menu: MenuItem) => {
    const { lines, adjusted: adj, unmatched } = fromRecipe(menu.ingredients, blocks);
    if (lines.length === 0) {
      infoDialog('Nothing to copy', `${menu.name} has no items on it yet.`);
      return;
    }
    // Merge rather than replace, so two menus can be combined into one plan.
    setSelectedItems((prev) => {
      const have = new Set(prev.map((p) => p.item_id));
      return [...prev, ...lines.filter((l) => !have.has(l.item_id))];
    });
    setAdjusted(adj);
    setMenuPickerOpen(false);
    if (unmatched.length > 0) {
      infoDialog(
        'Some items were skipped',
        `${unmatched.join(', ')} — no matching item on the Menu Items tab.`,
      );
    }
  };

  const handleSave = () => {
    if (!planName.trim()) { infoDialog('Error', 'Enter a plan name'); return; }
    if (isNaN(days) || days <= 0) { infoDialog('Error', 'Enter a valid number of days'); return; }
    if (!selectedCycle) { infoDialog('Error', 'No delivery cycles available'); return; }
    if (selectedItems.length === 0) {
      infoDialog('Error', 'Add at least one item to the plan');
      return;
    }

    // Prefilled or typed, the price is now always the value in the box — so a
    // plan can never again be saved at one day's worth for a thirty-day run.
    const finalPrice = parseFloat(priceInput);
    if (isNaN(finalPrice) || finalPrice <= 0) {
      infoDialog('Error', 'Enter a valid plan price');
      return;
    }

    // Savings is the admin-stated discount vs buying à la carte — optional,
    // shown as "You Save" on PlanDetail. Blank → 0 (row hidden there).
    const savings = parseFloat(savingsInput);

    addPlan.mutate(
      {
        plan_name: planName.trim(),
        cycle_id: selectedCycle.id,
        plan_type: planType,
        duration_days: days,
        price: finalPrice,
        savings_amount: isNaN(savings) || savings < 0 ? 0 : savings,
        plan_items: JSON.stringify(selectedItems),
      },
      {
        onSuccess: () => navigation.goBack(),
        onError: (e: any) => infoDialog('Error', e?.message ?? 'Failed to save plan'),
      }
    );
  };

  const cycleLabel = selectedCycle
    ? planType === 'essentials'
      ? `${CYCLE_DISPLAY[selectedCycle.cycle_name] ?? selectedCycle.cycle_name}  ›`
      : `${selectedCycle.cycle_name}  ›`
    : '…';
  const typeLabel = isFood ? 'Food' : 'Essentials';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Create {typeLabel} Plan
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Cycle toggle — sets WHEN the plan dispatches. It does not narrow the
            item list: a block belongs to no mealtime. */}
        <TouchableOpacity
          style={styles.cycleRow}
          onPress={() => cycles.length && setCycleIdx((p) => (p + 1) % cycles.length)}
          activeOpacity={0.7}
        >
          <ThemedText variant="body" color="mint" style={styles.txt}>{cycleLabel}</ThemedText>
        </TouchableOpacity>

        {/* Plan name */}
        <TextInput
          style={styles.input}
          placeholder="Plan name"
          placeholderTextColor={Theme.colors.text.muted}
          value={planName}
          onChangeText={setPlanName}
        />

        {/* Number of days */}
        <TextInput
          style={styles.input}
          placeholder="Number of days  (e.g. 30)"
          placeholderTextColor={Theme.colors.text.muted}
          value={daysInput}
          onChangeText={setDaysInput}
          keyboardType="number-pad"
        />

        {/* ── Contents ─────────────────────────────────────── */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          {isFood ? 'THIS PLAN DELIVERS EACH DAY' : 'SELECT ESSENTIALS'}
        </ThemedText>

        {selectedItems.map((si) => {
          const b = source.find((x) => x.id === si.item_id);
          const lineCost = (Number(b?.price) || 0) * si.quantity;
          // Food shows the block's measured portion ("150 ml"); an essential
          // shows its pack description ("1L") as-is — see handleAddItem.
          const portionLabel = isFood
            ? `${Number(si.base_quantity ?? portionOf(b)) || 1} ${si.unit ?? toMenuUnit(b?.unit)}`
            : (b?.unit ?? '');
          return (
            <View key={si.item_id} style={styles.selectedRow}>
              <ThemedText variant="body" color="primary" style={[styles.txt, styles.selectedName]} numberOfLines={1}>
                {si.item_name}
              </ThemedText>
              {/* The item's own portion — a fact, not a field. It is changed
                  on the Menu Items tab so every menu and plan using it stays
                  in step. */}
              <ThemedText variant="small" color="muted" style={styles.portion}>
                {portionLabel}
              </ThemedText>
              <View style={styles.qtyRow}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => handleQtyChange(si.item_id, -1)}>
                  <ThemedText variant="body" color="muted" style={styles.txt}>−</ThemedText>
                </TouchableOpacity>
                <ThemedText variant="body" color="primary" style={[styles.txt, styles.qtyNum]}>
                  {si.quantity}
                </ThemedText>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => handleQtyChange(si.item_id, 1)}>
                  <ThemedText variant="body" color="muted" style={styles.txt}>+</ThemedText>
                </TouchableOpacity>
                <ThemedText variant="small" color={lineCost > 0 ? 'mint' : 'muted'} style={styles.lineCost}>
                  {lineCost > 0 ? formatPriceShort(lineCost) : '—'}
                </ThemedText>
                <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemoveItem(si.item_id)}>
                  <ThemedText variant="body" color="muted" style={styles.txt}>×</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {selectedItems.length === 0 && (
          <ThemedText variant="small" color="muted" style={styles.hint}>
            Nothing yet — find its parts below.
          </ThemedText>
        )}

        {perDay > 0 && (
          <View style={styles.perDayRow}>
            <ThemedText variant="small" color="muted" style={styles.hint}>Per day</ThemedText>
            <ThemedText variant="body" color="mint" style={styles.txt}>{formatPriceShort(perDay)}</ThemedText>
          </View>
        )}

        {/* Rounding from a menu prefill, named rather than swallowed. */}
        {adjusted.length > 0 && (
          <ThemedText variant="small" color="warning" style={styles.hint}>
            {adjusted.map((a) => `${a.name} ${a.from} → ${a.to}`).join('; ')} — rounded to whole
            portions. Adjust the counts if that is not what you want.
          </ThemedText>
        )}

        {/* Type-to-search picker */}
        <TextInput
          style={[styles.input, styles.findBox]}
          placeholder={isFood ? 'Add an item — type a letter or two' : 'Add an essential — type a letter or two'}
          placeholderTextColor={Theme.colors.text.muted}
          value={find}
          onChangeText={setFind}
          autoCorrect={false}
        />
        {find.trim().length > 0 && matches.length === 0 && (
          <ThemedText variant="small" color="muted" style={styles.hint}>
            {isFood
              ? `Nothing matches “${find.trim()}”. Create it on the Menu Items tab first.`
              : `Nothing matches “${find.trim()}”.`}
          </ThemedText>
        )}
        {matches.map((b) => (
          <TouchableOpacity
            key={b.id}
            style={styles.availableRow}
            onPress={() => handleAddItem(b)}
            activeOpacity={0.7}
          >
            <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]} numberOfLines={1}>
              {b.name}
            </ThemedText>
            {/* Its own portion, so the count you are about to set has
                something to be relative to. Priced at ₹0 — which is every
                block until one is sold on its own — the money is left off
                rather than shown as a meaningless zero. */}
            <ThemedText variant="small" color={b.price > 0 ? 'mint' : 'muted'} style={styles.subTxt}>
              {b.price > 0 ? `${formatPriceShort(b.price)} for ` : ''}
              {isFood ? `${portionOf(b)} ${toMenuUnit(b.unit)}` : (b.unit ?? '')}
            </ThemedText>
            <ThemedText variant="body" color="mint" style={styles.addBtn}>+</ThemedText>
          </TouchableOpacity>
        ))}

        {/* Start from a menu — food only. A shortcut over the picker, never a
            second way to store a plan: what lands is the menu's BLOCKS. */}
        {isFood && cycleMenus.length > 0 && (
          <>
            <TouchableOpacity
              style={styles.fromMenuRow}
              onPress={() => setMenuPickerOpen((p) => !p)}
              activeOpacity={0.7}
            >
              <ThemedText variant="body" color="mint" style={styles.txt}>
                {menuPickerOpen ? 'Start from a menu  ⌄' : 'Start from a menu  ›'}
              </ThemedText>
            </TouchableOpacity>
            {menuPickerOpen && (
              <>
                <ThemedText variant="small" color="muted" style={styles.hint}>
                  Copies that menu&apos;s items in as editable rows. The plan still holds the
                  items themselves, not the menu.
                </ThemedText>
                {(cycleMenus as MenuItem[])
                  .filter((m) => m.is_active)
                  .map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={styles.availableRow}
                      onPress={() => handleStartFromMenu(m)}
                      activeOpacity={0.7}
                    >
                      <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]} numberOfLines={1}>
                        {m.name}
                      </ThemedText>
                      <ThemedText variant="small" color="muted" style={styles.subTxt} numberOfLines={1}>
                        {formatPriceShort(m.price)}
                      </ThemedText>
                      <ThemedText variant="body" color="mint" style={styles.addBtn}>+</ThemedText>
                    </TouchableOpacity>
                  ))}
              </>
            )}
          </>
        )}

        {/* ── Price ────────────────────────────────────────── */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>PRICE</ThemedText>
        <View style={styles.priceRow}>
          <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]}>
            Plan price
          </ThemedText>
          <ThemedText variant="body" color="mint" style={styles.rupee}>₹</ThemedText>
          <TextInput
            style={styles.priceBox}
            placeholder="0"
            placeholderTextColor={Theme.colors.text.muted}
            value={priceInput}
            onChangeText={(t) => { priceTouched.current = true; setPriceInput(t); }}
            keyboardType="decimal-pad"
          />
        </View>
        {suggested > 0 && (
          <ThemedText variant="small" color="muted" style={styles.hint}>
            {formatPriceShort(perDay)} a day × {days} days = {formatPriceShort(suggested)}
            {priceTouched.current && parseFloat(priceInput) !== suggested
              ? ' — you have set your own price.'
              : ''}
          </ThemedText>
        )}

        {/* Savings vs à la carte — optional, shown as "You Save" on PlanDetail */}
        <TextInput
          style={styles.input}
          placeholder="Savings amount  ₹  (optional)"
          placeholderTextColor={Theme.colors.text.muted}
          value={savingsInput}
          onChangeText={setSavingsInput}
          keyboardType="decimal-pad"
        />
      </ScrollView>

      <TouchableOpacity
        style={styles.footer}
        onPress={handleSave}
        disabled={addPlan.isPending}
        activeOpacity={0.7}
      >
        <ThemedText variant="body" color={addPlan.isPending ? 'muted' : 'mint'} style={styles.txt}>
          {addPlan.isPending ? 'Saving...' : 'Save Plan  ›'}
        </ThemedText>
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

  scroll: { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },

  cycleRow: {
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    alignSelf: 'flex-start',
    marginBottom: Theme.spacing.md,
  },

  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm + 2,
    marginBottom: Theme.spacing.sm,
  },
  findBox: { marginTop: Theme.spacing.md, borderBottomColor: Theme.colors.text.mint },

  sectionLabel: {
    letterSpacing: 1,
    fontSize: S,
    marginTop: Theme.spacing.lg,
    marginBottom: Theme.spacing.xs,
  },
  hint: { fontSize: S, paddingVertical: Theme.spacing.xs },

  availableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    gap: Theme.spacing.sm,
  },
  addBtn: { fontSize: B + 2 },
  flex1: { flex: 1 },

  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    gap: Theme.spacing.sm,
  },
  selectedName: { flex: 1 },
  // Right-aligned so the portions form a column the eye can run down, however
  // long the item's name is — same as the menu editor.
  portion: { fontSize: S, textAlign: 'right' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.xs },
  qtyBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 4,
  },
  qtyNum: { minWidth: 28, textAlign: 'center' },
  lineCost: { fontSize: S, minWidth: 52, textAlign: 'right' },
  removeBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },

  perDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Theme.spacing.sm,
  },

  fromMenuRow: {
    paddingVertical: Theme.spacing.sm + 2,
    alignSelf: 'flex-start',
  },

  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    gap: Theme.spacing.sm,
  },
  rupee: { fontSize: B },
  priceBox: {
    width: 96,
    textAlign: 'right',
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: 2,
  },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },

  txt: { fontSize: B },
  subTxt: { fontSize: S },
});
