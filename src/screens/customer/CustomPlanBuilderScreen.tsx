/**
 * 1stOne F1 — Build your own plan
 *
 * Four questions, in the order a person actually answers them: when does it
 * arrive, what is in it, how long for, and when does it start. Then the price,
 * then the button.
 *
 * THE PRICE HERE IS A PREVIEW, NOT AN OFFER. Every number on this screen is
 * recomputed by `create_custom_plan` from the catalogue and the admin's slab
 * before a plan exists — the phone sends a spec and never a price, exactly as
 * the cart does. The local copy is only so the total moves while the customer
 * changes their mind; if the two ever disagree, the server's answer is the one
 * that gets bought.
 *
 * WHAT IT REFUSES, and why each is said out loud rather than just disabling a
 * button: at least one meal (a plan is food with essentials alongside, not a
 * milk round), one delivery time, up to five items, 10 to 45 days, and one
 * running custom plan per time of day. The server enforces all of them; this
 * screen states them so nobody gets to the end and is told no.
 *
 * LENGTH STARTS AT 45 DAYS — the biggest discount — and steps DOWN. That is
 * deliberate, and it is also anchoring, so two things keep it honest: the row
 * is unmistakably tappable (mint, with a chevron, like everything else in this
 * app that opens), and the button carries the REAL total, so the size of the
 * commitment is never a surprise at the payment screen.
 *
 * THE START DATE IS ASKED LAST, and the plan row is still created HERE rather
 * than at checkout: the cart then carries an ordinary plan_id, so quote-order
 * and place-order need no changes at all — and place-order's payload is not
 * backward compatible, so avoiding it means the app and the functions do not
 * have to ship together.
 */

import React, { useEffect, useMemo, useState } from 'react';
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
import { ScreenHeader } from '../../components/ScreenHeader';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { CatalogPhotoThumb } from '../../components/CatalogPhotoThumb';
import { PICK_TILE } from './components/AddExtraStrip';
import { PHOTO_BUCKET, PHOTO_PX } from '../../utils/catalogPhoto';
import { formatPriceShort, formatDateShort, getErrorMessage } from '../../utils/formatters';
import { formatTime12h } from '../../utils/timeEngine';
import { essentialsCycleLabel } from '../../utils/cycleLabels';
import { istDateStr } from '../../utils/istDate';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useCycleDispatch } from '../../hooks/useCycleDispatch';
import { useMySubscriptions } from '../../hooks/useSubscriptions';
import { useCartStore } from '../../store/cartStore';
import {
  findCoreItemConflict,
  startAfterDate,
  type ActiveSubForConflict,
} from '../../utils/subscriptionConflict';
import {
  useBuilderItems,
  useDiscountSlabs,
  useCreateCustomPlan,
  discountForDays,
  type EligibleItem,
} from '../../hooks/useCustomPlanConfig';
import type { CustomerScreenProps } from '../../navigation/types';
import type { CartPlan } from '../../types';

/** Mirrored in create_custom_plan; the server is the one that enforces them. */
const MAX_ITEMS = 5;
const MAX_QTY = 10;

/**
 * Longest first, so the customer meets the best per-day price before the
 * smaller commitments.
 *
 * THREE STEPS, NOT FOUR, because of arithmetic rather than taste: the live
 * slabs are 10–19 → 5%, 20–34 → 8%, 35–45 → 12%, so any fourth option repeats
 * a discount — and a step down that costs nothing quietly contradicts what the
 * row is there to say. 45 / 30 / 15 is one per band, every step visibly worse
 * than the one above it, and they are the lengths people think in.
 */
const DAY_STEPS = [45, 30, 15];

/** How far ahead a start date may be chosen. */
const START_WINDOW = 14;

interface Chosen { item: EligibleItem; quantity: number }

export function CustomPlanBuilderScreen({
  navigation,
}: CustomerScreenProps<'CustomPlanBuilder'>) {
  const { data: cycles = [] } = useDeliveryCycles();
  const { data: dispatchByCycle } = useCycleDispatch();
  const { data: mySubs } = useMySubscriptions();
  const setPlan = useCartStore((s) => s.setSinglePlan);

  const [cycleId, setCycleId] = useState<number | null>(null);
  const [chosen, setChosen] = useState<Record<string, Chosen>>({});
  const [days, setDays] = useState(DAY_STEPS[0]);
  const [datesOpen, setDatesOpen] = useState(false);
  /**
   * Open until something is chosen, then closed on EVERY add — the cart's
   * picker behaves the same way and for the same reason: an open shelf is an
   * unresolved decision on screen, and once something is in the list, the list
   * is what matters. Only "+ Add item" opens it again.
   */
  const [pickerOpen, setPickerOpen] = useState(true);
  const [startOffset, setStartOffset] = useState(0);

  /**
   * Open on the first cycle rather than on nothing. An empty state that says
   * "choose a delivery time" is a question with an obvious answer for most
   * people — the earliest run — and asking it first put a wall in front of the
   * screen. The row still cycles, so changing it costs one tap.
   */
  useEffect(() => {
    if (cycleId == null && cycles.length > 0) setCycleId(cycles[0].id);
  }, [cycles, cycleId]);

  const { data: items = [], isLoading } = useBuilderItems(cycleId);
  const { data: slabs = [] } = useDiscountSlabs();
  const { mutateAsync: create, isPending } = useCreateCustomPlan();

  const activeCycle = cycles.find((c) => c.id === cycleId);
  const picked = useMemo(() => Object.values(chosen), [chosen]);
  const foodCount = picked.filter((p) => p.item.item_type === 'food').length;
  const atCap = picked.length >= MAX_ITEMS;

  const daily = picked.reduce((s, p) => s + p.item.price * p.quantity, 0);
  const pct = discountForDays(days, slabs);
  const full = Math.round(daily * days * 100) / 100;
  const price = Math.round(full * (1 - pct / 100) * 100) / 100;
  const savings = Math.round((full - price) * 100) / 100;

  /**
   * The earliest day this cycle can start, server-derived. A cycle past its
   * cutoff cannot start today, and a cross-midnight one cannot start tomorrow
   * either — the same A/B/C rule the cart and the order path use, so this
   * calendar cannot offer a date the purchase would then refuse.
   */
  const earliestOffset = useMemo(() => {
    if (cycleId == null || !dispatchByCycle) return 1;
    const s = dispatchByCycle.get(cycleId)?.scenario;
    return s === 'A' ? 0 : s === 'C' ? 2 : 1;
  }, [cycleId, dispatchByCycle]);

  const startDates = useMemo(
    () =>
      Array.from({ length: START_WINDOW }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + earliestOffset + i);
        return d;
      }),
    [earliestOffset],
  );
  const startDate = startDates[startOffset] ?? startDates[0];

  /**
   * Changing the delivery time clears the basket, and has to: eligibility is
   * per cycle, so a dish chosen for breakfast is not on offer at dinner and
   * the server would refuse the whole plan at the last step.
   */
  const nextCycle = () => {
    if (cycles.length === 0) return;
    const i = cycles.findIndex((c) => c.id === cycleId);
    setCycleId(cycles[(i + 1) % cycles.length].id);
    setChosen({});
    setStartOffset(0);
    setPickerOpen(true);
  };
  const nextDays = () => {
    const i = DAY_STEPS.indexOf(days);
    setDays(DAY_STEPS[(i + 1) % DAY_STEPS.length]);
  };

  const keyOf = (i: EligibleItem) => `${i.item_type}:${i.id}`;

  const addItem = (item: EligibleItem) => {
    const k = keyOf(item);
    setChosen((cur) => {
      if (cur[k] || Object.keys(cur).length >= MAX_ITEMS) return cur;
      // EVERY add closes the shelf; only "+ Add item" opens it again. One
      // choice at a time, and the thing just chosen is the next thing read.
      setPickerOpen(false);
      return { ...cur, [k]: { item, quantity: 1 } };
    });
  };

  /** −1 at a quantity of one removes the line, exactly as the cart does. */
  const step = (item: EligibleItem, delta: number) => {
    const k = keyOf(item);
    setChosen((cur) => {
      const at = cur[k];
      if (!at) return cur;
      const q = at.quantity + delta;
      if (q < 1) {
        const next = { ...cur };
        delete next[k];
        return next;
      }
      // Capped at the server's MAX_QTY, so the ceiling is met as a dead button
      // here rather than as a refusal after the whole form has been filled in.
      if (q > MAX_QTY) return cur;
      return { ...cur, [k]: { ...at, quantity: q } };
    });
  };

  const blocker =
    cycleId == null ? 'Choose a delivery time'
      : picked.length === 0 ? 'Add at least one item'
        : foodCount === 0 ? 'Add at least one meal — essentials come alongside'
          : null;

  /** Everything already running, in the shape the conflict check reads. */
  const activeSubs: ActiveSubForConflict[] = useMemo(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((mySubs ?? []) as any[])
        .filter((s) => s.is_active)
        .map((s) => ({
          id: s.id,
          start_date: s.start_date,
          plan_id: s.plan_id,
          plan_items: (() => {
            const raw = s.subscription_plans?.plan_items;
            if (!raw) return [];
            if (Array.isArray(raw)) return raw;
            try { return JSON.parse(raw); } catch { return []; }
          })(),
          duration_days: s.subscription_plans?.duration_days ?? 0,
          plan_name: s.subscription_plans?.plan_name ?? 'an existing plan',
          plan_type: s.subscription_plans?.plan_type ?? 'food',
          cycle_id: s.subscription_plans?.cycle_id ?? 0,
        })),
    [mySubs],
  );

  const buildAndBuy = async (start: Date) => {
    if (cycleId == null) return;
    try {
      const plan = await create({
        cycleId,
        durationDays: days,
        items: picked.map((p) => ({
          item_id: p.item.id, item_type: p.item.item_type, quantity: p.quantity,
        })),
      });
      const cartPlan: CartPlan = {
        plan_id: plan.plan_id,
        plan_name: plan.plan_name,
        price: plan.price,
        duration_days: plan.duration_days,
        cycle_id: cycleId,
        // 'food' always — a plan must hold at least one meal, and each LINE
        // carries its own type now (see create_custom_plan).
        plan_type: 'food',
        start_date: istDateStr(start),
        plan_item_ids: picked.map((p) => p.item.id),
      };
      setPlan(cartPlan);
      navigation.navigate('Checkout', { subscriptionPlanId: plan.plan_id });
    } catch (e) {
      // The server's own sentence — it names the rule that was hit.
      Alert.alert('Could not build that plan', getErrorMessage(e));
    }
  };

  /**
   * THE OVERLAP CHECK RUNS HERE, not at payment.
   *
   * `buildAuthoritativeOrder` refuses a plan delivering an item another running
   * plan already delivers over the same dates — correctly, but that refusal
   * arrives as a 409 on the checkout screen, after everything has been chosen
   * and Pay has been tapped. Asking here costs one lookup that is already
   * loaded, and turns a dead end into a choice.
   */
  const onBuild = () => {
    if (blocker || cycleId == null) return;
    const ids = new Set(picked.map((p) => p.item.id));
    const clash = findCoreItemConflict('food', ids, activeSubs);
    if (clash) {
      const after = startAfterDate(clash);
      Alert.alert(
        'You already get this',
        `"${clash.plan_name}" is running and delivers the same item. You can start this one after it finishes.`,
        [
          { text: `Start ${formatDateShort(after)}`, onPress: () => buildAndBuy(new Date(after)) },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }
    buildAndBuy(startDate);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Build a plan" />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* ── When ──
             The TIME is the control; the name follows it. Tapping the clock is
             the closest thing to "when do you want this", and the name is the
             answer rather than a second thing to press.

             MORNING / NOON / EVENING, not Breakfast / Lunch. `cycle_name` is
             the kitchen's word for a production run; `essentials_label` is the
             one already shown to customers everywhere a cycle is named. */}
        <PickRow
          label="Delivery dispatched at"
          value={activeCycle ? formatTime12h(activeCycle.delivery_start) : 'Tap to choose'}
          valueBump={2}
          onPress={nextCycle}
          trailing={activeCycle ? essentialsCycleLabel(activeCycle) : undefined}
          trailingBig
        />

        {/* ── What is in it ── */}
        {picked.length > 0 && (
          <>
            <Divider />
            {picked.map(({ item, quantity }) => (
              <View key={keyOf(item)} style={styles.line}>
                <View style={styles.lineText}>
                  <ThemedText variant="body" color="primary" numberOfLines={1}>{item.name}</ThemedText>
                  <ThemedText variant="small" color="muted">
                    {formatPriceShort(item.price)} each
                  </ThemedText>
                </View>
                <View style={styles.stepper}>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => step(item, -1)}>
                    <ThemedText variant="body" color="primary">−</ThemedText>
                  </TouchableOpacity>
                  <ThemedText variant="body" color="primary" style={styles.qty}>{quantity}</ThemedText>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => step(item, +1)}>
                    <ThemedText variant="body" color={quantity >= MAX_QTY ? 'muted' : 'primary'}>
                      +
                    </ThemedText>
                  </TouchableOpacity>
                </View>
                <ThemedText variant="body" color="accent" style={styles.lineTotal}>
                  {formatPriceShort(item.price * quantity)}
                </ThemedText>
              </View>
            ))}
            {/* A rule above it and a point of size: without those it was the
                same weight as the line costs directly above and read as a
                fourth item rather than as their sum. */}
            <View style={styles.perDay}>
              <ThemedText variant="small" color="muted">Per day</ThemedText>
              <ThemedText variant="body" color="accent" style={styles.perDayAmount}>
                {formatPriceShort(daily)}
              </ThemedText>
            </View>
          </>
        )}

        {/* ── The picker ── */}
        {cycleId != null && (
          <>
            <Divider />
            {/* Closed it is one line; open it is a shelf. Same shape as the
                cart's "Add something else?", so a customer meets the pattern
                once and knows it here. */}
            <TouchableOpacity
              style={styles.pickerHead}
              activeOpacity={0.7}
              disabled={atCap}
              onPress={() => setPickerOpen((v) => !v)}
              accessibilityRole="button"
            >
              {/* ONE PHRASE, however many are in the basket. A running "2 of
                  5" counts down to a limit nobody asked about, and the list
                  above already shows exactly what has been chosen. The cap
                  only needs saying at the moment it starts refusing. */}
              <ThemedText variant="body" color={atCap ? 'muted' : 'mint'} style={styles.tapLabel}>
                {atCap ? `All ${MAX_ITEMS} chosen — remove one to swap` : '+  Add item'}
              </ThemedText>
              {!atCap && (
                <ThemedText variant="body" color="mint" style={styles.chev}>
                  {pickerOpen ? '⌃' : '⌄'}
                </ThemedText>
              )}
            </TouchableOpacity>

            {pickerOpen && !atCap && (
              isLoading ? (
                <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
              ) : items.length === 0 ? (
                <EmptyState
                  title="Nothing available yet"
                  subtitle={`No ${activeCycle?.cycle_name ?? 'items'} are offered for plans at the moment.`}
                />
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.strip}
                >
                  {items.map((it) => {
                    const already = !!chosen[keyOf(it)];
                    /**
                     * A NAME ONLY WHERE THERE IS NO PHOTO. A photographed dish
                     * identifies itself and the caption is noise — and the item
                     * appears named in the list above the moment it is tapped,
                     * so the confirmation is immediate either way.
                     *
                     * Without a photo every tile falls back to the SAME generic
                     * plate or basket, so five unphotographed dishes would be
                     * five identical grey squares and the only way to learn what
                     * one is would be to add it.
                     */
                    const named = !it.image_path;
                    return (
                      <TouchableOpacity
                        key={keyOf(it)}
                        style={styles.tileWrap}
                        activeOpacity={0.7}
                        disabled={already}
                        onPress={() => addItem(it)}
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${it.name}`}
                      >
                        <View style={already ? styles.tileDim : undefined}>
                          <CatalogPhotoThumb
                            bucket={it.item_type === 'food' ? PHOTO_BUCKET.menu : PHOTO_BUCKET.essentials}
                            item={it}
                            size={PICK_TILE}
                            requestPx={PHOTO_PX.admin}
                            fallbackIcon={it.item_type === 'food' ? 'restaurant-outline' : 'basket-outline'}
                          />
                        </View>
                        {!already && (
                          <View style={styles.plus}>
                            <ThemedText variant="micro" color="mint">+</ThemedText>
                          </View>
                        )}
                        {named && (
                          <ThemedText
                            variant="micro"
                            color={already ? 'muted' : 'subtitle'}
                            numberOfLines={1}
                            style={styles.tileName}
                          >
                            {it.name}
                          </ThemedText>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )
            )}
          </>
        )}

        {/* ── How long, and when ── */}
        {picked.length > 0 && (
          <>
            <Divider />
            {/* The discount is REPORTED, not pressed. Only the length is a
                choice; the percentage is what that choice earns, and making it
                look tappable would offer a control that does not exist. */}
            <PickRow
              label="How many days?"
              value={`${days} days`}
              valueBump={1}
              onPress={nextDays}
              trailing={pct > 0 ? `${pct}% OFF` : undefined}
            />
            {/* Straight under the length, because it is the consequence of it.
                The full price is struck through rather than stated twice — the
                saving is the point, and the button carries the real total. */}
            {/* The saving leads and the price lands under it, both to the
                right — the eye finishes on the number that will be charged,
                and it sits in the same column as the line costs above. */}
            <View style={styles.priceBlock}>
              {savings > 0 && (
                <ThemedText variant="small" color="mint">
                  you save {formatPriceShort(savings)}
                </ThemedText>
              )}
              <ThemedText variant="subtitle" color="accent">{formatPriceShort(price)}</ThemedText>
            </View>

            <Divider />
            <PickRow
              label="Starts"
              value={formatDateShort(istDateStr(startDate))}
              onPress={() => setDatesOpen((v) => !v)}
              chevron={datesOpen ? '⌃' : '⌄'}
            />
            {datesOpen && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.dateRow}
              >
                {startDates.map((d, i) => {
                  const on = i === startOffset;
                  return (
                    <TouchableOpacity
                      key={d.toISOString()}
                      style={[styles.datePill, on && styles.datePillOn]}
                      onPress={() => { setStartOffset(i); setDatesOpen(false); }}
                      activeOpacity={0.7}
                    >
                      <ThemedText variant="micro" color={on ? 'mint' : 'muted'}>
                        {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                      </ThemedText>
                      <ThemedText variant="body" color={on ? 'mint' : 'primary'}>{d.getDate()}</ThemedText>
                      <ThemedText variant="micro" color={on ? 'mint' : 'muted'}>
                        {d.toLocaleDateString('en-IN', { month: 'short' })}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </>
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.floatBtn}
        activeOpacity={0.85}
        disabled={!!blocker || isPending}
        onPress={onBuild}
        accessibilityRole="button"
      >
        {isPending
          ? <ActivityIndicator color={Theme.colors.text.mint} />
          : (
            <ThemedText variant="body" style={styles.floatBtnText}>
              {blocker ?? `Create my plan and subscribe · ${formatPriceShort(price)}  ›`}
            </ThemedText>
          )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

/**
 * One line of the form: what it asks on the left, the answer in the middle,
 * and — where there is one — a consequence on the right.
 *
 * ONLY THE MIDDLE IS PRESSABLE. The trailing slot holds things that are
 * REPORTED rather than chosen: the cycle's name, the discount a length earns.
 * Making them look tappable would offer a control that does not exist, and
 * wrapping the whole row would mean a customer aiming at "12% OFF" changes the
 * number of days.
 *
 * THE VALUE IS CENTRED AND MINT. A row that cycles on tap has no other way of
 * saying so — the alternatives are every option on screen at once (chips,
 * which is what this screen used to be) or nothing at all. Mint is what the
 * rest of the app uses for "you can act on this".
 */
function PickRow({
  label, value, trailing, onPress, valueBump = 0, trailingBig, chevron,
}: {
  label: string;
  value: string;
  trailing?: string;
  onPress: () => void;
  /** Points above `body`. The dispatch time and the length are the two things
   *  a customer is actually setting, so both stand above their labels. */
  valueBump?: number;
  trailingBig?: boolean;
  chevron?: string;
}) {
  return (
    <View style={styles.pickRow}>
      <ThemedText variant="body" color="subtitle" style={styles.tapLabel}>{label}</ThemedText>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        style={styles.valueTap}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}. Tap to change.`}
      >
        <ThemedText
          variant="body"
          color="mint"
          style={valueBump ? { fontSize: Theme.typography.sizes.body + valueBump } : undefined}
        >
          {value}
        </ThemedText>
        {!!chevron && <ThemedText variant="body" color="mint" style={styles.chev}>{chevron}</ThemedText>}
      </TouchableOpacity>
      {!!trailing && (
        <ThemedText
          variant={trailingBig ? 'subtitle' : 'body'}
          color={trailingBig ? 'primary' : 'mint'}
          style={styles.trailing}
          numberOfLines={1}
        >
          {trailing}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { padding: Theme.spacing.md, paddingBottom: 110 },
  label: { letterSpacing: 1, marginTop: Theme.spacing.sm, marginBottom: Theme.spacing.xs },

  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: Theme.components.touchMin,
  },
  pickerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: Theme.components.touchMin,
    gap: Theme.spacing.sm,
  },
  tapLabel: { flex: 1 },
  /** The answer sits between the question and its consequence, and carries the
   *  whole touch target — see the note on PickRow. */
  valueTap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: Theme.components.touchMin,
    paddingHorizontal: Theme.spacing.sm,
  },
  trailing: { flex: 1, textAlign: 'right' },
  chev: { marginLeft: Theme.spacing.xs },
  priceBlock: {
    alignItems: 'flex-end',
    paddingBottom: Theme.spacing.xs,
  },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.xs,
  },
  lineText: { flex: 1, marginRight: Theme.spacing.sm },
  lineTotal: { minWidth: 64, textAlign: 'right' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 8,
    marginRight: Theme.spacing.sm,
  },
  stepBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  qty: { minWidth: 22, textAlign: 'center' },
  perDay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Theme.spacing.xs,
    paddingTop: Theme.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  perDayAmount: { fontSize: Theme.typography.sizes.body + 1 },

  /** Tighter than the cart's strip: no captions to keep apart. */
  strip: { gap: Theme.spacing.sm, paddingVertical: Theme.spacing.xs },
  tileWrap: { alignItems: 'center', width: PICK_TILE + 8 },
  tileDim: { opacity: 0.35 },
  plus: {
    position: 'absolute',
    top: -4,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: { marginTop: 2, textAlign: 'center' },

  dateRow: { gap: Theme.spacing.sm, paddingVertical: Theme.spacing.sm },
  datePill: {
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
    alignItems: 'center',
    minWidth: 52,
  },
  datePillOn: { borderColor: Theme.colors.text.mint },



  loader: { marginTop: Theme.spacing.lg },
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
